/**
 * Cookie-free pageview analytics — stored locally on the admin server.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ANALYTICS_FILE = 'data/analytics.json';
const RETENTION_DAYS = 90;
const DEDUPE_WINDOW_MS = 30 * 1000;

function createAnalyticsApi({ root, clientIp, send, parseBody, checkRate }) {
  const filePath = () => path.join(root, ANALYTICS_FILE);
  const recentHits = new Map();

  function readStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
      return Array.isArray(raw.pageviews) ? raw : { pageviews: [] };
    } catch {
      return { pageviews: [] };
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(store, null, 2) + '\n', 'utf8');
  }

  function yangonDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Yangon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function pruneOld(pageviews) {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return pageviews.filter((pv) => new Date(pv.at).getTime() >= cutoff);
  }

  function isBot(ua) {
    return /bot|crawler|spider|slurp|facebookexternalhit|preview|headless/i.test(
      String(ua || '')
    );
  }

  function parseUserAgent(ua) {
    const s = String(ua || '');
    let device = 'desktop';
    if (/Mobile|Android.*Mobile|iPhone|iPod/i.test(s)) device = 'mobile';
    else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(s)) device = 'tablet';

    let os = 'Other';
    if (/Windows/i.test(s)) os = 'Windows';
    else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
    else if (/Android/i.test(s)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
    else if (/Linux/i.test(s)) os = 'Linux';

    let browser = 'Other';
    if (/Edg\//i.test(s)) browser = 'Edge';
    else if (/Chrome\//i.test(s) && !/Edg/i.test(s)) browser = 'Chrome';
    else if (/Firefox\//i.test(s)) browser = 'Firefox';
    else if (/Safari\//i.test(s) && !/Chrome/i.test(s)) browser = 'Safari';
    else if (/OPR\//i.test(s)) browser = 'Opera';

    return { device, os, browser };
  }

  function visitorHash(ip, ua, dateKey) {
    return crypto
      .createHash('sha256')
      .update(`${ip}|${ua}|${dateKey}`)
      .digest('hex')
      .slice(0, 16);
  }

  function shouldSkipDuplicate(ip, pathValue) {
    const key = `${ip}|${pathValue}`;
    const now = Date.now();
    const last = recentHits.get(key) || 0;
    if (now - last < DEDUPE_WINDOW_MS) return true;
    recentHits.set(key, now);
    if (recentHits.size > 5000) {
      for (const [k, t] of recentHits) {
        if (now - t > DEDUPE_WINDOW_MS) recentHits.delete(k);
      }
    }
    return false;
  }

  function countBy(items, key) {
    const map = {};
    for (const item of items) {
      const val = item[key] || 'Unknown';
      map[val] = (map[val] || 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }

  function uniqueVisitors(pageviews) {
    return new Set(pageviews.map((pv) => pv.visitorId)).size;
  }

  function buildStats(store) {
    const all = store.pageviews;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const todayKey = yangonDateKey();
    const today = all.filter((pv) => pv.dateKey === todayKey);
    const last7 = all.filter((pv) => now - new Date(pv.at).getTime() <= 7 * dayMs);
    const last30 = all.filter((pv) => now - new Date(pv.at).getTime() <= 30 * dayMs);

    return {
      totals: {
        pageviews: all.length,
        uniqueVisitors: uniqueVisitors(all),
        todayPageviews: today.length,
        todayUnique: uniqueVisitors(today),
        last7Pageviews: last7.length,
        last7Unique: uniqueVisitors(last7),
        last30Pageviews: last30.length,
        last30Unique: uniqueVisitors(last30),
      },
      devices: countBy(last30, 'device'),
      browsers: countBy(last30, 'browser'),
      os: countBy(last30, 'os'),
      topPages: countBy(last30, 'path').slice(0, 12),
      referrers: countBy(
        last30.filter((pv) => pv.referrer && pv.referrer !== 'direct'),
        'referrer'
      ).slice(0, 8),
      recent: [...all]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, 40)
        .map((pv) => ({
          at: pv.at,
          path: pv.path,
          device: pv.device,
          browser: pv.browser,
          os: pv.os,
          screen: pv.screen || '',
          referrer: pv.referrer || 'direct',
        })),
    };
  }

  async function handlePageview(req, res) {
    if (checkRate && !checkRate(clientIp(req))) {
      send(res, 429, { error: 'Too many requests' });
      return;
    }

    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) {
      send(res, 204, '');
      return;
    }

    const body = await parseBody(req);
    const pagePath = String(body.path || '/').slice(0, 300);
    if (pagePath.startsWith('/admin')) {
      send(res, 204, '');
      return;
    }
    if (shouldSkipDuplicate(clientIp(req), pagePath)) {
      send(res, 204, '');
      return;
    }

    const { device, os, browser } = parseUserAgent(ua);
    const dateKey = yangonDateKey();
    const ip = clientIp(req);
    const entry = {
      at: new Date().toISOString(),
      dateKey,
      path: pagePath,
      referrer: String(body.referrer || 'direct').slice(0, 300),
      screen: String(body.screen || '').slice(0, 20),
      device,
      os,
      browser,
      visitorId: visitorHash(ip, ua, dateKey),
    };

    const store = readStore();
    store.pageviews.push(entry);
    store.pageviews = pruneOld(store.pageviews);
    writeStore(store);
    send(res, 200, { ok: true });
  }

  function handleStats(req, res) {
    const store = readStore();
    store.pageviews = pruneOld(store.pageviews);
    send(res, 200, buildStats(store));
  }

  return { handlePageview, handleStats };
}

module.exports = { createAnalyticsApi };
