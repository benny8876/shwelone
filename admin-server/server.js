#!/usr/bin/env node
/**
 * Shwe Lone Myanmar — local admin API
 * Serves /admin and writes insights + policy HTML to disk.
 *
 * Usage: node admin-server/server.js
 * Default: http://localhost:8790/admin/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const sharp = require('sharp');
const { createLiveChatApi } = require('./live-chat');
const { createAnalyticsApi } = require('./analytics');
const {
  isCrossOriginDenied,
  hashPassword,
  verifyPasswordHash,
  isLegacyPasswordHash,
  buildApiHeaders,
  buildStaticHeaders,
  getAllowedOrigins,
} = require('./security');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ADMIN_PORT) || 8790;
const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 8;
const DEFAULT_SETTINGS = { imageWatermark: true, logo: 'assets/2-nobg.png' };
const TELEGRAM_RATE_WINDOW_MS = 60 * 1000;
const TELEGRAM_CONTACT_RATE_MAX = 8;
const TELEGRAM_LIVE_REQUEST_RATE_MAX = 5;
const TELEGRAM_LIVE_MESSAGE_RATE_MAX = 120;
const telegramContactRate = new Map();
const telegramLiveRequestRate = new Map();
const telegramLiveMessageRate = new Map();
const analyticsRate = new Map();
const loginRate = new Map();
const ANALYTICS_RATE_MAX = 120;
const LOGIN_RATE_MAX = 5;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

let activeReq = null;

loadEnvFile();

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function getTelegramConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    groupId: process.env.TELEGRAM_GROUP_ID || '',
  };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRate(ip, map, windowMs, max) {
  const now = Date.now();
  const bucket = map.get(ip) || [];
  const recent = bucket.filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  map.set(ip, recent);
  return true;
}

function checkTelegramRate(ip) {
  return checkRate(ip, telegramContactRate, TELEGRAM_RATE_WINDOW_MS, TELEGRAM_CONTACT_RATE_MAX);
}

function checkLiveRequestRate(ip) {
  return checkRate(
    ip,
    telegramLiveRequestRate,
    TELEGRAM_RATE_WINDOW_MS,
    TELEGRAM_LIVE_REQUEST_RATE_MAX
  );
}

function checkLiveMessageRate(ip) {
  return checkRate(
    ip,
    telegramLiveMessageRate,
    TELEGRAM_RATE_WINDOW_MS,
    TELEGRAM_LIVE_MESSAGE_RATE_MAX
  );
}

function checkLoginRate(ip) {
  return checkRate(ip, loginRate, LOGIN_RATE_WINDOW_MS, LOGIN_RATE_MAX);
}

function checkAnalyticsRate(ip) {
  return checkRate(ip, analyticsRate, TELEGRAM_RATE_WINDOW_MS, ANALYTICS_RATE_MAX);
}

function cleanText(value, max = 2000) {
  return String(value || '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, max);
}

async function sendTelegramMessage(text) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) {
    throw new Error('Telegram is not configured on the server (.env)');
  }

  let lastErr;
  for (let attempt = 0; attempt <= 4; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 35000);
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4096),
          disable_web_page_preview: true,
        }),
      });
      clearTimeout(timer);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.description || 'Telegram send failed');
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function appendContactLog(entry) {
  const rel = 'data/contact-messages.json';
  const file = path.join(ROOT, rel);
  let store = { messages: [] };
  try {
    store = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* new file */
  }
  if (!Array.isArray(store.messages)) store.messages = [];
  store.messages.push(entry);
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

async function handleTelegramContact(req, res) {
  if (!checkTelegramRate(clientIp(req))) {
    send(res, 429, { error: 'Too many requests. Please try again shortly.' });
    return;
  }
  const body = await parseBody(req);
  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 160);
  const phone = cleanText(body.phone, 60);
  const subject = cleanText(body.subject, 200);
  const planLabel = cleanText(body.planLabel || body.plan, 200);
  const message = cleanText(body.message, 3000);

  if (!name || !email || !subject || !message) {
    send(res, 400, { error: 'Name, email, subject, and message are required.' });
    return;
  }

  const text = [
    '📩 New contact — Shwe Lone Myanmar',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : null,
    `Subject: ${subject}`,
    planLabel ? `Plan: ${planLabel}` : null,
    '',
    'Message:',
    message,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await sendTelegramMessage(text);
    appendContactLog({
      id: Date.now(),
      type: 'contact',
      name,
      email,
      phone,
      subject,
      plan: planLabel,
      message,
      createdAt: new Date().toISOString(),
    });
    send(res, 200, { ok: true });
  } catch (err) {
    console.error('Telegram contact failed:', err.message);
    send(res, 502, { error: 'Could not send message. Please try again or call the office.' });
  }
}

async function handleTelegramChat(req, res) {
  if (!checkTelegramRate(clientIp(req))) {
    send(res, 429, { error: 'Too many requests. Please try again shortly.' });
    return;
  }
  const body = await parseBody(req);
  const message = cleanText(body.message, 2000);
  if (!message) {
    send(res, 400, { error: 'Message is required.' });
    return;
  }

  const text = ['💬 Ask Shwe Lone — chat message', '', message].join('\n');

  try {
    await sendTelegramMessage(text);
    appendContactLog({
      id: Date.now(),
      type: 'chat',
      message,
      createdAt: new Date().toISOString(),
    });
    send(res, 200, { ok: true });
  } catch (err) {
    console.error('Telegram chat failed:', err.message);
    send(res, 502, { error: 'Could not send message. Please try again.' });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function readJson(rel) {
  const file = path.join(ROOT, rel);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(rel, data) {
  const file = path.join(ROOT, rel);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getAdminConfig() {
  return readJson('data/admin-config.json');
}

function verifyPassword(pw) {
  const cfg = getAdminConfig();
  return verifyPasswordHash(pw, cfg.passwordHash);
}

function upgradePasswordHashIfLegacy(pw) {
  const cfg = getAdminConfig();
  if (!isLegacyPasswordHash(cfg.passwordHash)) return;
  if (!verifyPasswordHash(pw, cfg.passwordHash)) return;
  cfg.passwordHash = hashPassword(pw);
  writeJson('data/admin-config.json', cfg);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  return token;
}

function isAuthed(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, buildApiHeaders(activeReq, type));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function parseBody(req, maxBytes = 2e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getSiteSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...readJson('data/site-settings.json') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function ensureUploadsDir() {
  const dir = path.join(ROOT, 'assets', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const IMAGE_MAX_LONG_EDGE = 1600;
const THUMB_WIDTH = 1200;
const THUMB_HEIGHT = 750;

async function encodeImageBuffer(buf, ext) {
  let outExt = ext;
  if (outExt === 'gif') outExt = 'png';
  if (outExt === 'jpg' || outExt === 'jpeg') {
    return { buf: await sharp(buf).jpeg({ quality: 88 }).toBuffer(), ext: 'jpg' };
  }
  if (outExt === 'webp') {
    return { buf: await sharp(buf).webp({ quality: 88 }).toBuffer(), ext: 'webp' };
  }
  return { buf: await sharp(buf).png().toBuffer(), ext: 'png' };
}

async function resizeIfNeeded(buf) {
  const meta = await sharp(buf).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const longEdge = Math.max(width, height);
  if (longEdge <= IMAGE_MAX_LONG_EDGE) return { buf, width, height };

  const resized = await sharp(buf)
    .resize({
      width: width >= height ? IMAGE_MAX_LONG_EDGE : undefined,
      height: height > width ? IMAGE_MAX_LONG_EDGE : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer();
  const next = await sharp(resized).metadata();
  return { buf: resized, width: next.width || width, height: next.height || height };
}

async function applyLogoWatermark(imageBuf) {
  const settings = getSiteSettings();
  if (settings.imageWatermark === false) return imageBuf;

  const logoRel = settings.logo || 'assets/2-nobg.png';
  const logoPath = path.join(ROOT, logoRel);
  if (!fs.existsSync(logoPath)) return imageBuf;

  const image = sharp(imageBuf);
  const meta = await image.metadata();
  const width = meta.width || 1200;
  const height = meta.height || 800;

  const maxCorner = Math.max(32, Math.floor(Math.min(width, height) * 0.2));
  const maxCenter = Math.max(40, Math.floor(Math.min(width, height) * 0.35));
  const pad = Math.max(4, Math.round(Math.min(width, height) * 0.03));

  async function fitLogo(maxSide, opacity) {
    let logo = sharp(logoPath).ensureAlpha();
    const lm = await sharp(logoPath).metadata();
    const lw = lm.width || maxSide;
    const lh = lm.height || maxSide;
    const scale = Math.min(maxSide / lw, maxSide / lh, 1);
    const tw = Math.max(1, Math.floor(lw * scale));
    const th = Math.max(1, Math.floor(lh * scale));
    const resized = await logo.resize({ width: tw, height: th, fit: 'inside' }).png().toBuffer();
    const rm = await sharp(resized).metadata();
    const faded = await sharp(resized)
      .composite([
        {
          input: Buffer.from(
            `<svg width="${rm.width}" height="${rm.height}">
              <rect width="100%" height="100%" fill="white" fill-opacity="${opacity}"/>
            </svg>`
          ),
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();
    return { buf: faded, w: rm.width || tw, h: rm.height || th };
  }

  const center = await fitLogo(maxCenter, 0.16);
  const corner = await fitLogo(maxCorner, 0.5);

  const centerLeft = Math.max(0, Math.round((width - center.w) / 2));
  const centerTop = Math.max(0, Math.round((height - center.h) / 2));
  const cornerLeft = Math.max(0, width - corner.w - pad);
  const cornerTop = Math.max(0, height - corner.h - pad);

  return image
    .composite([
      { input: center.buf, left: centerLeft, top: centerTop },
      { input: corner.buf, left: cornerLeft, top: cornerTop },
    ])
    .toBuffer();
}

async function saveDataUrlImage(dataUrl, preferredName) {
  const match = String(dataUrl || '').match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!match) throw new Error('Invalid image data');
  let ext = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase();
  let buf = Buffer.from(match[3], 'base64');
  if (buf.length > 6e6) throw new Error('Image must be under 6MB');

  const sized = await resizeIfNeeded(buf);
  buf = sized.buf;
  const isPortrait = sized.height > sized.width * 1.15;

  buf = await applyLogoWatermark(buf);

  const { buf: fullBuf, ext: outExt } = await encodeImageBuffer(buf, ext);

  const base = slugify(preferredName || `upload-${Date.now()}`).replace(/\.(png|jpe?g|webp|gif)$/i, '');
  const suffix = Date.now().toString(36);
  const filename = `${base}-${suffix}.${outExt}`;
  const thumbFilename = `${base}-${suffix}-thumb.jpg`;
  const dir = ensureUploadsDir();

  fs.writeFileSync(path.join(dir, filename), fullBuf);

  const thumbBuf = await sharp(fullBuf)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 85 })
    .toBuffer();
  fs.writeFileSync(path.join(dir, thumbFilename), thumbBuf);

  return {
    url: `assets/uploads/${filename}`,
    thumbUrl: `assets/uploads/${thumbFilename}`,
    isPortrait,
  };
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'insight';
}

function formatInsightDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function generateInsightHtml(insight) {
  const slug = insight.slug || insight.id;
  const dateLabel = formatInsightDate(insight.date);
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(insight.title)} — Insights</title>
  <meta name="description" content="${esc(insight.excerpt)}" />
  <link rel="canonical" href="../insight.html?slug=${esc(slug)}" />
  <meta http-equiv="refresh" content="0; url=../insight.html?slug=${esc(slug)}" />
  <link rel="stylesheet" href="../css/styles.css?v=svc7" />
</head>
<body>
  <p><a href="../insight.html?slug=${esc(slug)}">Continue to article</a></p>
</body>
</html>
`;
}

function extractPolicyMeta(html) {
  const title = (html.match(/<h1>([^<]*)<\/h1>/) || [])[1] || '';
  const legalMeta = (html.match(/<p class="legal-meta">([\s\S]*?)<\/p>/) || [])[1]?.trim() || '';
  const lead = (html.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1]?.trim() || '';
  const org = (html.match(/<p class="legal-org">([\s\S]*?)<\/p>/) || [])[1]?.trim() || '';
  const enMatch = html.match(/<article class="legal-body" data-panel="en">([\s\S]*?)<\/article>/);
  const mmMatch = html.match(/<article class="legal-body" data-panel="mm"[^>]*>([\s\S]*?)<\/article>/);
  return {
    title,
    legalMeta,
    lead,
    org,
    bodyEn: enMatch ? enMatch[1].trim() : '',
    bodyMm: mmMatch ? mmMatch[1].trim() : '',
  };
}

function updatePolicyHtml(html, data) {
  let out = html;
  if (data.title) {
    out = out.replace(/<title>[^<]*<\/title>/, `<title>${data.title} — Shwe Lone Myanmar</title>`);
    out = out.replace(/<h1>[^<]*<\/h1>/, `<h1>${data.title}</h1>`);
  }
  if (data.legalMeta !== undefined) {
    out = out.replace(
      /<p class="legal-meta">[\s\S]*?<\/p>/,
      `<p class="legal-meta">${data.legalMeta}</p>`
    );
  }
  if (data.lead !== undefined) {
    out = out.replace(/<p class="lead">[\s\S]*?<\/p>/, `<p class="lead">${data.lead}</p>`);
  }
  if (data.org !== undefined) {
    out = out.replace(/<p class="legal-org">[\s\S]*?<\/p>/, `<p class="legal-org">${data.org}</p>`);
  }
  if (data.bodyEn !== undefined) {
    out = out.replace(
      /<article class="legal-body" data-panel="en">[\s\S]*?<\/article>/,
      `<article class="legal-body" data-panel="en">\n        ${data.bodyEn}\n      </article>`
    );
  }
  if (data.bodyMm !== undefined) {
    out = out.replace(
      /<article class="legal-body" data-panel="mm"[^>]*>[\s\S]*?<\/article>/,
      `<article class="legal-body" data-panel="mm" hidden>\n        ${data.bodyMm}\n      </article>`
    );
  }
  return out;
}

function serveStatic(req, res, filePath) {
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const isPublicHtml =
      ext === '.html' && !filePath.includes(`${path.sep}admin${path.sep}`);
    let body = data;
    if (isPublicHtml) {
      let html = data.toString('utf8');
      const inject = [];
      if (!html.includes('js/site-api.js')) {
        inject.push('<script src="/js/site-api.js?v=1"></script>');
      }
      if (!html.includes('js/analytics.js')) {
        inject.push('<script src="/js/analytics.js?v=2" defer></script>');
      }
      if (inject.length) {
        const tags = inject.map((t) => `  ${t}`).join('\n') + '\n';
        html = html.includes('</body>')
          ? html.replace('</body>', `${tags}</body>`)
          : `${html}\n${tags}`;
        body = Buffer.from(html, 'utf8');
      }
    }
    res.writeHead(200, {
      ...buildStaticHeaders(MIME[ext] || 'application/octet-stream'),
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(body);
  });
}

async function handleApi(req, res, pathname) {
  if (isCrossOriginDenied(req)) {
    send(res, 403, { error: 'Origin not allowed' });
    return;
  }

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (!checkLoginRate(clientIp(req))) {
      send(res, 429, { error: 'Too many login attempts. Try again in 15 minutes.' });
      return;
    }
    const body = await parseBody(req);
    if (!verifyPassword(body.password || '')) {
      send(res, 401, { error: 'Invalid password' });
      return;
    }
    upgradePasswordHashIfLegacy(body.password || '');
    const token = createSession();
    send(res, 200, { token });
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    sessions.delete(token);
    send(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/session' && req.method === 'GET') {
    send(res, 200, { authed: isAuthed(req) });
    return;
  }

  if (pathname === '/api/analytics/pageview' && req.method === 'POST') {
    await analytics.handlePageview(req, res);
    return;
  }

  const needsAuth =
    pathname.startsWith('/api/insights') ||
    pathname.startsWith('/api/policies') ||
    pathname.startsWith('/api/chat/archive') ||
    pathname === '/api/analytics/stats' ||
    pathname === '/api/change-password' ||
    pathname === '/api/upload' ||
    pathname === '/api/site-settings';

  if (needsAuth && !isAuthed(req)) {
    send(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (pathname === '/api/telegram/contact' && req.method === 'POST') {
    await handleTelegramContact(req, res);
    return;
  }

  if (pathname === '/api/telegram/chat' && req.method === 'POST') {
    await handleTelegramChat(req, res);
    return;
  }

  const liveSessionMatch = pathname.match(/^\/api\/chat\/session\/([^/]+)$/);
  if (liveSessionMatch && req.method === 'GET') {
    await liveChat.handleSessionPoll(req, res, decodeURIComponent(liveSessionMatch[1]));
    return;
  }

  if (pathname === '/api/chat/live-request' && req.method === 'POST') {
    await liveChat.handleLiveRequest(req, res);
    return;
  }

  if (pathname === '/api/chat/live-message' && req.method === 'POST') {
    await liveChat.handleLiveMessage(req, res);
    return;
  }

  if (pathname === '/api/chat/live-close' && req.method === 'POST') {
    await liveChat.handleLiveClose(req, res);
    return;
  }

  if (pathname === '/api/chat/archive' && req.method === 'GET') {
    liveChat.handleChatArchiveList(req, res);
    return;
  }

  const archiveMatch = pathname.match(/^\/api\/chat\/archive\/([^/]+)$/);
  if (archiveMatch && req.method === 'GET') {
    liveChat.handleChatArchiveDetail(req, res, decodeURIComponent(archiveMatch[1]));
    return;
  }

  if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
    await liveChat.handleTelegramWebhook(req, res);
    return;
  }

  if (pathname === '/api/analytics/stats' && req.method === 'GET') {
    analytics.handleStats(req, res);
    return;
  }

  if (pathname === '/api/site-settings' && req.method === 'GET') {
    send(res, 200, getSiteSettings());
    return;
  }

  if (pathname === '/api/site-settings' && req.method === 'PUT') {
    const body = await parseBody(req);
    const next = {
      imageWatermark: body.imageWatermark !== false,
      logo: 'assets/2-nobg.png',
    };
    writeJson('data/site-settings.json', next);
    send(res, 200, { ok: true, ...next });
    return;
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    const body = await parseBody(req, 8e6);
    try {
      if (!body.dataUrl) throw new Error('No image data received');
      const result = await saveDataUrlImage(body.dataUrl, body.name);
      console.log('Uploaded:', result.url);
      send(res, 200, {
        ok: true,
        url: result.url,
        thumbUrl: result.thumbUrl,
        isPortrait: result.isPortrait,
        watermarked: getSiteSettings().imageWatermark !== false,
      });
    } catch (err) {
      console.error('Upload failed:', err);
      send(res, 400, { error: err.message || 'Upload failed' });
    }
    return;
  }

  if (pathname === '/api/change-password' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!verifyPassword(body.currentPassword || '')) {
      send(res, 401, { error: 'Current password incorrect' });
      return;
    }
    if (!body.newPassword || body.newPassword.length < 8) {
      send(res, 400, { error: 'New password must be at least 8 characters' });
      return;
    }
    const cfg = getAdminConfig();
    cfg.passwordHash = hashPassword(body.newPassword);
    writeJson('data/admin-config.json', cfg);
    send(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/insights' && req.method === 'GET') {
    send(res, 200, readJson('data/insights.json'));
    return;
  }

  if (pathname === '/api/insights' && req.method === 'PUT') {
    const body = await parseBody(req);
    const store = readJson('data/insights.json');
    const insights = Array.isArray(body.insights) ? body.insights : store.insights;

    insights.forEach((item) => {
      if (!item.id) item.id = slugify(item.title);
      if (!item.slug) item.slug = item.id;
    });

    writeJson('data/insights.json', { insights });

    const publishedSlugs = new Set(
      insights.filter((item) => item.published).map((item) => item.slug)
    );

    insights.forEach((item) => {
      if (!item.published) return;
      const legacy = path.join(ROOT, 'insights', `${item.slug}.html`);
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(legacy, generateInsightHtml(item), 'utf8');
    });

    const insightsDir = path.join(ROOT, 'insights');
    if (fs.existsSync(insightsDir)) {
      for (const file of fs.readdirSync(insightsDir)) {
        if (!file.endsWith('.html')) continue;
        const slug = file.replace(/\.html$/, '');
        if (!publishedSlugs.has(slug)) {
          try {
            fs.unlinkSync(path.join(insightsDir, file));
          } catch {
            /* ignore */
          }
        }
      }
    }

    send(res, 200, { ok: true, insights });
    return;
  }

  if (pathname === '/api/policies' && req.method === 'GET') {
    send(res, 200, readJson('data/policies-manifest.json'));
    return;
  }

  const policyMatch = pathname.match(/^\/api\/policies\/([^/]+)$/);
  if (policyMatch) {
    const id = decodeURIComponent(policyMatch[1]);
    const manifest = readJson('data/policies-manifest.json');
    const entry = manifest.policies.find((p) => p.id === id);
    if (!entry) {
      send(res, 404, { error: 'Policy not found' });
      return;
    }
    const filePath = path.join(ROOT, entry.file);

    if (req.method === 'GET') {
      const html = fs.readFileSync(filePath, 'utf8');
      send(res, 200, { ...entry, ...extractPolicyMeta(html) });
      return;
    }

    if (req.method === 'PUT') {
      const body = await parseBody(req);
      const html = fs.readFileSync(filePath, 'utf8');
      const updated = updatePolicyHtml(html, body);
      fs.writeFileSync(filePath, updated, 'utf8');
      send(res, 200, { ok: true, ...extractPolicyMeta(updated) });
      return;
    }
  }

  send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/') {
      res.writeHead(302, { Location: '/admin/' });
      res.end();
      return;
    }

    if (pathname.startsWith('/api/')) {
      activeReq = req;
      try {
        await handleApi(req, res, pathname);
      } finally {
        activeReq = null;
      }
      return;
    }

    if (pathname === '/admin') {
      res.writeHead(302, { Location: '/admin/' });
      res.end();
      return;
    }

    const rel = pathname === '/admin/' ? '/admin/index.html' : pathname;
    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) {
      send(res, 403, { error: 'Forbidden' });
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      serveStatic(req, res, path.join(filePath, 'index.html'));
      return;
    }

    if (fs.existsSync(filePath)) {
      serveStatic(req, res, filePath);
      return;
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message || 'Server error' });
  }
});

const liveChat = createLiveChatApi({
  root: ROOT,
  getTelegramConfig,
  cleanText,
  checkTelegramRate: checkLiveRequestRate,
  checkLiveMessageRate,
  checkSessionPollRate: checkAnalyticsRate,
  clientIp,
  send,
});

const analytics = createAnalyticsApi({
  root: ROOT,
  clientIp,
  send,
  parseBody,
  checkRate: checkAnalyticsRate,
});

server.listen(PORT, () => {
  liveChat.registerBotCommands();
  liveChat.startTelegramPolling();

  console.log(`Shwe Lone admin server running at http://localhost:${PORT}/admin/`);
  console.log(`CORS allowed origins: ${getAllowedOrigins().join(', ')}`);
  const tg = getTelegramConfig();
  if (tg.token && tg.chatId) {
    console.log('Telegram notifications: enabled (contact form → private chat)');
    if (tg.groupId) {
      console.log('Live chat: Telegram group with topics');
    } else {
      console.log('Live chat: private chat (set TELEGRAM_GROUP_ID for group topics)');
    }
    if (process.env.TELEGRAM_POLLING !== 'false') {
      console.log('Telegram polling: enabled (Accept/Reject + replies)');
    }
  } else {
    console.log('Telegram notifications: disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env)');
  }
});
