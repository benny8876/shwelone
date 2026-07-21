
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isWithinOfficeHours, officeHoursMessage } = require('./office-hours');

const SESSIONS_FILE = 'data/chat-sessions.json';
const ARCHIVE_FILE = 'data/chat-archive.json';
const CHAT_ARCHIVE_RETENTION_DAYS = Number(process.env.CHAT_ARCHIVE_RETENTION_DAYS) || 90;
const CHAT_ARCHIVE_MAX_SESSIONS = 500;
const LIVE_SESSION_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours
const CLOSED_GRACE_MS = 5 * 60 * 1000; // keep closed sessions for visitor poll
const CLOSE_BUTTON_LABEL = '🔚 Done Chat';
const TELEGRAM_FETCH_RETRIES = 4;
const TELEGRAM_FETCH_BASE_DELAY_MS = 1500;
const TELEGRAM_FETCH_TIMEOUT_MS = 35000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, config = {}) {
  const retries = config.retries ?? TELEGRAM_FETCH_RETRIES;
  const baseDelayMs = config.baseDelayMs ?? TELEGRAM_FETCH_BASE_DELAY_MS;
  const timeoutMs = config.timeoutMs ?? TELEGRAM_FETCH_TIMEOUT_MS;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * (attempt + 1));
      }
    }
  }

  throw lastErr;
}

let threadToSession = new Map();
let notifyToSession = new Map();
let telegramMsgToSession = new Map();
let topicToSession = new Map();
let telegramUpdateOffset = 0;
let polling = false;
let focusedSessionId = null;

function parseSessionIdFromText(text) {
  if (!text) return null;
  const patterns = [
    /Visitor\s*\(([a-f0-9]{12,32})\)/i,
    /Session:\s*([a-f0-9]{12,32})/i,
    /accepted\s*\(([a-f0-9]{12,32})\)/i,
    /Sent to visitor\s*\(([a-f0-9]{12,32})\)/i,
    /rejected\s*\(([a-f0-9]{12,32})\)/i,
    /Live chat request[^]*?Session:\s*([a-f0-9]{12,32})/i,
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m) return m[1];
  }
  return null;
}

function createLiveChatApi({
  root,
  getTelegramConfig,
  cleanText,
  checkTelegramRate,
  checkLiveMessageRate,
  checkSessionPollRate,
  clientIp,
  send,
  chatAnalytics,
  buildApiHeaders,
}) {
  const rateLiveMessage = checkLiveMessageRate || checkTelegramRate;
  const rateSessionPoll = checkSessionPollRate || (() => true);
  const sessionsPath = () => path.join(root, SESSIONS_FILE);
  /** @type {Map<string, Set<import('http').ServerResponse>>} */
  const streamSubscribers = new Map();

  function trackChat(type, meta) {
    try {
      chatAnalytics?.track?.(type, meta);
    } catch (_) {
      /* ignore */
    }
  }

  function notifySessionStream(sessionId, payload) {
    const set = streamSubscribers.get(sessionId);
    if (!set || !set.size) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of [...set]) {
      try {
        res.write(data);
      } catch {
        set.delete(res);
      }
    }
    if (!set.size) streamSubscribers.delete(sessionId);
  }

  function broadcastSession(session) {
    if (!session) return;
    notifySessionStream(session.id, {
      ok: true,
      sessionId: session.id,
      status: session.status,
      messages: [],
      nextIndex: (session.messages || []).length,
      full: false,
    });
  }

  function readStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(sessionsPath(), 'utf8'));
      return raw.sessions && typeof raw.sessions === 'object' ? raw : { sessions: {} };
    } catch {
      return { sessions: {} };
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(sessionsPath()), { recursive: true });
    fs.writeFileSync(sessionsPath(), JSON.stringify(store, null, 2) + '\n', 'utf8');
  }

  function getSession(id) {
    const store = readStore();
    return store.sessions[id] || null;
  }

  function registerTelegramMessage(session, messageId) {
    if (!session || !messageId) return;
    if (!Array.isArray(session.telegramMessageIds)) session.telegramMessageIds = [];
    if (!session.telegramMessageIds.includes(messageId)) {
      session.telegramMessageIds.push(messageId);
    }
    telegramMsgToSession.set(messageId, session.id);
  }

  function saveSession(session) {
    const store = readStore();
    store.sessions[session.id] = session;
    writeStore(store);
    if (session.adminThreadMessageId) {
      threadToSession.set(session.adminThreadMessageId, session.id);
    }
    if (session.notifyMessageId) {
      notifyToSession.set(session.notifyMessageId, session.id);
    }
    (session.telegramMessageIds || []).forEach((id) => {
      telegramMsgToSession.set(id, session.id);
    });
    if (session.telegramTopicId) {
      topicToSession.set(session.telegramTopicId, session.id);
    }
  }

  function rebuildMaps() {
    threadToSession = new Map();
    notifyToSession = new Map();
    telegramMsgToSession = new Map();
    topicToSession = new Map();
    const store = readStore();
    Object.values(store.sessions).forEach((s) => {
      if (s.adminThreadMessageId) threadToSession.set(s.adminThreadMessageId, s.id);
      if (s.notifyMessageId) notifyToSession.set(s.notifyMessageId, s.id);
      (s.telegramMessageIds || []).forEach((id) => telegramMsgToSession.set(id, s.id));
      if (s.telegramTopicId) topicToSession.set(s.telegramTopicId, s.id);
    });
  }

  function getLiveChatId(config) {
    return config.groupId || config.chatId;
  }

  function usesGroupTopics(config) {
    return !!config.groupId;
  }

  function sessionTopicOptions(session) {
    if (!session?.telegramTopicId) return {};
    return { message_thread_id: session.telegramTopicId };
  }

  async function ensureSessionTopic(session) {
    const config = getTelegramConfig();
    if (!usesGroupTopics(config) || session.telegramTopicId) return session.telegramTopicId;

    const stamp = new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const namePart = (session.visitorName || 'Visitor').slice(0, 40);
    const reasonPart = (session.visitorReason || '').slice(0, 50);
    const topicName =
      (reasonPart ? `${namePart} · ${reasonPart}` : `${namePart} · ${stamp}`).slice(0, 128);
    const created = await telegramCall(
      'createForumTopic',
      { name: topicName.slice(0, 128) },
      'live'
    );
    session.telegramTopicId = created.result.message_thread_id;
    topicToSession.set(session.telegramTopicId, session.id);
    return session.telegramTopicId;
  }

  async function closeSessionTopic(session) {
    const config = getTelegramConfig();
    if (!usesGroupTopics(config) || !session.telegramTopicId) return;
    try {
      await telegramCall(
        'closeForumTopic',
        { message_thread_id: session.telegramTopicId },
        'live'
      );
    } catch (err) {
      console.warn('closeForumTopic:', err.message);
    }
  }

  function resolveSessionIdFromMessage(message) {
    const threadId = message.message_thread_id;
    if (threadId && topicToSession.has(threadId)) {
      return topicToSession.get(threadId);
    }
    return resolveSessionIdFromReply(message);
  }

  function resolveSessionIdFromReply(message) {
    let current = message.reply_to_message;
    while (current) {
      const id = current.message_id;
      if (threadToSession.has(id)) return threadToSession.get(id);
      if (notifyToSession.has(id)) return notifyToSession.get(id);
      if (telegramMsgToSession.has(id)) return telegramMsgToSession.get(id);

      const parsed = parseSessionIdFromText(current.text);
      if (parsed && getSession(parsed)) return parsed;

      current = current.reply_to_message;
    }
    return null;
  }

  function getMostRecentActiveSessionId() {
    const store = readStore();
    const active = Object.values(store.sessions)
      .filter((s) => s.status === 'active')
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime()
      );
    return active[0]?.id || null;
  }

  function getFocusedSessionId() {
    if (focusedSessionId) {
      const s = getSession(focusedSessionId);
      if (s && s.status === 'active') return focusedSessionId;
    }
    return getMostRecentActiveSessionId();
  }

  function setFocusedSession(sessionId) {
    const s = getSession(sessionId);
    if (s && s.status === 'active') focusedSessionId = sessionId;
  }

  function initFocusedSession() {
    focusedSessionId = getMostRecentActiveSessionId();
  }

  function pruneOldSessions() {
    const store = readStore();
    const now = Date.now();
    let changed = false;
    for (const [id, s] of Object.entries(store.sessions)) {
      const age = now - new Date(s.updatedAt || s.createdAt).getTime();
      if (
        (s.status === 'rejected' || s.status === 'closed') &&
        age > CLOSED_GRACE_MS
      ) {
        delete store.sessions[id];
        changed = true;
        continue;
      }
      if (age > LIVE_SESSION_TTL_MS) {
        delete store.sessions[id];
        changed = true;
      }
    }
    if (changed) writeStore(store);
    rebuildMaps();
  }

  function pruneArchiveSessions(archive) {
    const cutoff = Date.now() - CHAT_ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    archive.sessions = (archive.sessions || []).filter((s) => {
      const closed = s.closedAt || s.createdAt;
      if (!closed) return true;
      const t = new Date(closed).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
    if (archive.sessions.length > CHAT_ARCHIVE_MAX_SESSIONS) {
      archive.sessions.length = CHAT_ARCHIVE_MAX_SESSIONS;
    }
    return archive;
  }

  function archiveSessionCopy(session) {
    const archivePath = path.join(root, ARCHIVE_FILE);
    let archive = { sessions: [] };
    try {
      archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    } catch {
      /* new file */
    }
    if (!Array.isArray(archive.sessions)) archive.sessions = [];

    const entry = {
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      closedAt: session.closedAt || session.updatedAt || new Date().toISOString(),
      closedBy: session.closedBy || 'unknown',
      visitorName: session.visitorName || '',
      visitorReason: session.visitorReason || '',
      messageCount: (session.messages || []).length,
      messages: session.messages || [],
    };

    const idx = archive.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) archive.sessions[idx] = entry;
    else archive.sessions.unshift(entry);

    pruneArchiveSessions(archive);

    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n', 'utf8');
  }

  async function closeSession(sessionId, closedBy = 'admin') {
    const session = getSession(sessionId);
    if (!session) return false;
    if (session.status !== 'active' && session.status !== 'pending') return false;

    const farewell =
      closedBy === 'visitor'
        ? 'သင်သည် chat ကို ပြီးဆုံးခဲ့ပြီ။ ကျေးဇူးတင်ပါတယ်။'
        : 'ရုံးနှင့် ဆက်သွယ်မှု ပြီးဆုံးပါပြီ။ ကျေးဇူးတင်ပါတယ်။';

    pushMessage(session, 'system', farewell);
    session.status = 'closed';
    session.closedAt = new Date().toISOString();
    session.closedBy = closedBy;
    saveSession(session);
    archiveSessionCopy(session);
    trackChat('live_closed', { sessionId, closedBy });
    broadcastSession(session);

    if (focusedSessionId === sessionId) focusedSessionId = null;

    await closeSessionTopic(session);

    try {
      await telegramSendLive(
        session,
        [
          `🔚 Chat ended (${sessionId})`,
          `Closed by: ${closedBy}`,
          'History saved to website archive.',
        ].join('\n'),
        { reply_markup: removeChatKeyboard() }
      );
    } catch (err) {
      console.warn('Telegram close notify:', err.message);
    }

    return true;
  }

  function newSessionId() {
    return crypto.randomBytes(12).toString('hex');
  }

  function pushMessage(session, from, text) {
    const at = new Date().toISOString();
    session.messages.push({ from, text, at });
    session.updatedAt = at;

    if (from === 'admin' && !session.firstAdminReplyAt && session.acceptedAt) {
      session.firstAdminReplyAt = at;
      const responseMs = new Date(at).getTime() - new Date(session.acceptedAt).getTime();
      if (responseMs >= 0) {
        trackChat('first_admin_reply', {
          sessionId: session.id,
          responseMs,
        });
      }
    }

    notifySessionStream(session.id, {
      ok: true,
      sessionId: session.id,
      status: session.status,
      messages: [{ from, text, at }],
      nextIndex: session.messages.length,
      full: false,
    });
  }

  async function telegramCall(method, body, channel = 'live') {
    const config = getTelegramConfig();
    const { token } = config;
    if (!token) throw new Error('Telegram is not configured');

    const chat_id =
      channel === 'private'
        ? config.chatId
        : getLiveChatId(config);

    if (!chat_id) {
      throw new Error(
        channel === 'private'
          ? 'TELEGRAM_CHAT_ID is not configured'
          : 'TELEGRAM_GROUP_ID or TELEGRAM_CHAT_ID is not configured'
      );
    }

    const resp = await fetchWithRetry(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, ...body }),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
    return data;
  }

  async function telegramSendLive(session, text, extra = {}) {
    const payload = {
      text: text.slice(0, 4096),
      disable_web_page_preview: true,
      ...sessionTopicOptions(session),
      ...extra,
    };
    return telegramCall('sendMessage', payload, 'live');
  }

  async function telegramSendPrivate(text, extra = {}) {
    return telegramCall(
      'sendMessage',
      {
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
        ...extra,
      },
      'private'
    );
  }

  async function telegramAnswerCallback(callbackQueryId, text) {
    const { token } = getTelegramConfig();
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  }

  async function clearInlineKeyboard(query) {
    if (!query.message?.message_id || !query.message?.chat?.id) return;
    const { token } = getTelegramConfig();
    await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }),
    });
  }

  function liveChatCloseInline(sessionId) {
    return {
      inline_keyboard: [
        [{ text: '🔚 Chat ပီးပါပြီ — Close', callback_data: `live_close:${sessionId}` }],
      ],
    };
  }

  function liveChatCloseKeyboard() {
    return {
      keyboard: [[{ text: '/close' }], [{ text: CLOSE_BUTTON_LABEL }]],
      resize_keyboard: true,
      is_persistent: true,
    };
  }

  function removeChatKeyboard() {
    return { remove_keyboard: true };
  }

  function parseCloseRequest(text) {
    if (!text) return null;
    const closeCmd = text.match(/^\/(?:close|end|stop)(?:@\w+)?(?:\s+([a-f0-9]{12,32}))?$/i);
    if (closeCmd) return { sessionId: closeCmd[1] || null };
    if (text.trim() === CLOSE_BUTTON_LABEL) return { sessionId: null };
    return null;
  }

  async function runCloseSession(sessionId, sessionIdFromTopic, replyFn) {
    const sid = sessionId || sessionIdFromTopic;
    if (!sid) {
      if (replyFn) await replyFn('❌ Active chat မရှိပါ');
      return false;
    }
    const target = getSession(sid);
    const ok = await closeSession(sid, 'admin');
    if (replyFn && target) {
      await replyFn(ok ? `🔚 Chat ${sid} ended & archived` : `❌ Could not close ${sid}`);
    }
    return ok;
  }

  async function routeAdminReply(sessionId, text) {
    const session = getSession(sessionId);
    if (!session || session.status !== 'active') return false;
    if (!text || /^\/\S/.test(text)) return false;
    pushMessage(session, 'admin', text);
    saveSession(session);
    return true;
  }

  async function acceptSession(sessionId) {
    const session = getSession(sessionId);
    if (!session || session.status !== 'pending') return;

    session.status = 'active';
    session.acceptedAt = new Date().toISOString();
    trackChat('live_accepted', { sessionId });
    pushMessage(
      session,
      'system',
      'ရုံးမှ လက်ခံခဲ့ပါသည်။ စာပို့နိုင်ပါပြီ။'
    );

    await ensureSessionTopic(session);

    const inGroup = usesGroupTopics(getTelegramConfig());
    const helpText = inGroup
      ? [
          '• ဒီ topic ထဲ စာရိုး = visitor ဆီ ရောက်မယ်',
          '• Chat ပြီးရင် ↓ message အောက်က ခလုတ် နှိပ်ပါ',
          '• သို့မဟုတ် စာရိုက်ခန်း ဘေးက / နှိပ်ပြီး close ရွေးပါ',
        ].join('\n')
      : 'စာရိုးပြီး ပို့လိုက်ရုံနဲ့ visitor ဆီ ရောက်ပါမယ်။';

    const thread = await telegramSendLive(
      session,
      `✅ Live chat active (${sessionId})\n\n` +
        `👤 ${session.visitorName || 'Visitor'}\n` +
        (session.visitorReason ? `📋 ${session.visitorReason}\n\n` : '\n') +
        helpText,
      { reply_markup: liveChatCloseInline(sessionId) }
    );
    session.adminThreadMessageId = thread.result.message_id;
    registerTelegramMessage(session, thread.result.message_id);

    if (!inGroup) {
      const kb = await telegramSendLive(session, '⌨️ Chat ပြီးရင် အောက်ခလုတ် နှိပ်ပါ', {
        reply_markup: liveChatCloseKeyboard(),
      });
      registerTelegramMessage(session, kb.result.message_id);
    }
    setFocusedSession(sessionId);
    saveSession(session);
    broadcastSession(session);
  }

  async function rejectSession(sessionId) {
    const session = getSession(sessionId);
    if (!session || session.status !== 'pending') return;

    session.status = 'rejected';
    pushMessage(
      session,
      'system',
      [
        'ကျေးဇူးတင်ပါတယ် — ဆက်သွယ်မှု တောင်းဆိုပေးတဲ့အတွက်။',
        '',
        'ယခု ရုံးတွင် တိုက်ရိုက်ဆက်သွယ်ရန် မအားသေးပါ။',
        'နောက်တစ်ကြိမ် ထပ်ကြိုးစားနိုင်ပါသည် သို့မဟုတ် Contact Form မှတစ်ဆင့် ဆက်သွယ်နိုင်ပါတယ်။',
        '',
        'နားလည်ပေးတဲ့အတွက် ကျေးဇူးတင်ပါတယ်။',
      ].join('\n')
    );
    session.closedAt = new Date().toISOString();
    session.closedBy = 'admin';
    trackChat('live_rejected', { sessionId });
    saveSession(session);
    archiveSessionCopy(session);
    broadcastSession(session);

    await telegramSendLive(session, `❌ Live chat rejected (${sessionId})`);
    await closeSessionTopic(session);
  }

  async function handleCallbackQuery(query) {
    const data = query.data || '';
    const [action, sessionId] = data.split(':');
    if (!sessionId) return;

    if (action === 'live_accept') {
      await acceptSession(sessionId);
      await telegramAnswerCallback(query.id, 'လက်ခံပြီးပါပြီ');
      await clearInlineKeyboard(query);
      return;
    }

    if (action === 'live_reject') {
      await rejectSession(sessionId);
      await telegramAnswerCallback(query.id, 'ငြင်းပယ်ပြီးပါပြီ');
      await clearInlineKeyboard(query);
      return;
    }

    if (action === 'live_close') {
      const ok = await closeSession(sessionId, 'admin');
      await telegramAnswerCallback(query.id, ok ? 'Chat ပြီးပါပြီ' : 'မရပါ');
      if (ok) await clearInlineKeyboard(query);
    }
  }

  async function handlePrivateTelegramMessage(message) {
    const config = getTelegramConfig();
    const text = cleanText(message.text, 2000);
    if (!text) return;

    if (text.match(/^\/(?:start|help)(?:@\w+)?$/i)) {
      const lines = [
        '📬 Stand Law Firm Bot',
        '',
        '• Contact form notifications → ဒီ private chat',
      ];
      if (usesGroupTopics(config)) {
        lines.push('• Website live chat → Telegram group (topic တစ်ခုချင်းစီ)');
        lines.push('• Group topic ထဲ စာရိုး = visitor ဆီ ပြန်ပို့');
        lines.push('• /close → group topic ထဲမှာ သုံးပါ');
      } else {
        lines.push('• Live chat → ဒီ chat မှာ လက်ခံ/စာပို့');
        lines.push('• /close — chat ပြီးရင် ရပ်');
      }
      await telegramSendPrivate(lines.join('\n'));
      return;
    }

    if (usesGroupTopics(config)) return;

    await handleLegacyLiveMessage(message, text);
  }

  async function handleGroupLiveMessage(message) {
    const text = cleanText(message.text, 2000);
    if (!text) return;

    const sessionIdFromTopic = resolveSessionIdFromMessage(message);
    const session = sessionIdFromTopic ? getSession(sessionIdFromTopic) : null;

    if (text.match(/^\/(?:start|help)(?:@\w+)?$/i)) {
      if (session) {
        await telegramSendLive(
          session,
          [
            '💬 Live chat topic',
            '',
            'စာရိုးပြီး ပို့လိုက်ရုံနဲ့ visitor ဆီ ရောက်ပါမယ်',
            '/close — chat ပြီးရင် topic ပိတ်မယ်',
          ].join('\n')
        );
      }
      return;
    }

    const closeReq = parseCloseRequest(text);
    if (closeReq) {
      await runCloseSession(closeReq.sessionId, sessionIdFromTopic, (msg) =>
        session ? telegramSendLive(session, msg) : Promise.resolve()
      );
      return;
    }

    const cmd = text.match(/^\/(?:reply|r)\s+([a-f0-9]{12,32})\s+([\s\S]+)$/i);
    let sessionId = cmd ? cmd[1] : sessionIdFromTopic || getFocusedSessionId();
    if (!sessionId) return;

    const replyText = cmd ? cleanText(cmd[2], 2000) : text;
    await routeAdminReply(sessionId, replyText);
  }

  async function handleLegacyLiveMessage(message, text) {
    const closeReq = parseCloseRequest(text);
    if (closeReq) {
      await runCloseSession(closeReq.sessionId, getFocusedSessionId(), (msg) =>
        telegramSendPrivate(msg)
      );
      return;
    }

    const switchCmd = text.match(/^\/switch\s+([a-f0-9]{12,32})$/i);
    if (switchCmd) {
      const sid = switchCmd[1];
      const s = getSession(sid);
      if (s && s.status === 'active') {
        setFocusedSession(sid);
        await telegramSendPrivate(`✅ Active chat: ${sid}`);
      } else {
        await telegramSendPrivate(`❌ Session ${sid} is not active`);
      }
      return;
    }

    const cmd = text.match(/^\/(?:reply|r)\s+([a-f0-9]{12,32})\s+([\s\S]+)$/i);
    let sessionId = cmd ? cmd[1] : resolveSessionIdFromReply(message);
    if (!sessionId) sessionId = getFocusedSessionId();
    if (!sessionId) return;

    const replyText = cmd ? cleanText(cmd[2], 2000) : text;
    await routeAdminReply(sessionId, replyText);
  }

  async function handleAdminMessage(message) {
    const config = getTelegramConfig();
    const msgChatId = String(message.chat?.id || '');

    if (config.chatId && msgChatId === String(config.chatId)) {
      await handlePrivateTelegramMessage(message);
      return;
    }

    if (config.groupId && msgChatId === String(config.groupId)) {
      if (!message.message_thread_id) return;
      await handleGroupLiveMessage(message);
    }
  }

  async function processTelegramUpdate(update) {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }
    if (update.message) {
      await handleAdminMessage(update.message);
    }
  }

  async function registerBotCommands() {
    const { token, groupId } = getTelegramConfig();
    if (!token) return;

    const commands = [
      { command: 'close', description: '🔚 Live chat ပြီးရင် ရပ်ရန်' },
      { command: 'help', description: 'အကူအညီ' },
    ];

    const payloads = [
      { commands },
      { commands, scope: { type: 'all_group_chats' } },
      { commands, scope: { type: 'all_private_chats' } },
    ];
    if (groupId) {
      payloads.push({ commands, scope: { type: 'chat', chat_id: groupId } });
    }

    for (const body of payloads) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        /* ignore */
      }
    }
  }

  async function pollTelegramUpdates() {
    const { token } = getTelegramConfig();
    if (!token || polling) return;
    polling = true;

    await registerBotCommands();

    const usePolling = process.env.TELEGRAM_POLLING !== 'false';
    if (!usePolling) {
      polling = false;
      return;
    }

    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    } catch {
      /* ignore */
    }

    (async function loop() {
      while (true) {
        try {
          const resp = await fetchWithRetry(
            `https://api.telegram.org/bot${token}/getUpdates` +
              `?offset=${telegramUpdateOffset}&timeout=25`,
            {},
            { timeoutMs: 40000, retries: 5 }
          );
          const data = await resp.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              telegramUpdateOffset = update.update_id + 1;
              await processTelegramUpdate(update);
            }
          }
        } catch (err) {
          console.warn('Telegram poll:', err.message);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
  }

  async function handleLiveRequest(req, res) {
    if (!checkTelegramRate(clientIp(req))) {
      send(res, 429, { error: 'Too many requests. Please try again shortly.' });
      return;
    }

    if (!isWithinOfficeHours()) {
      send(res, 403, {
        error: officeHoursMessage(),
        code: 'outside_office_hours',
      });
      return;
    }

    const body = await parseBody(req);
    const visitorName = cleanText(body.visitorName, 80);
    const visitorReason = cleanText(body.visitorReason, 500);

    if (!visitorName || visitorName.length < 2) {
      send(res, 400, { error: 'Name is required (at least 2 characters).' });
      return;
    }
    if (!visitorReason || visitorReason.length < 5) {
      send(res, 400, { error: 'Reason is required (at least 5 characters).' });
      return;
    }

    pruneOldSessions();

    const sessionId = newSessionId();
    const session = {
      id: sessionId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      visitorName,
      visitorReason,
      notifyMessageId: null,
      adminThreadMessageId: null,
      telegramTopicId: null,
      messages: [
        {
          from: 'system',
          text: 'ရုံးကို ဆက်သွယ်နေပါသည်… ခဏစောင့်ပါ။',
          at: new Date().toISOString(),
        },
      ],
    };

    try {
      await ensureSessionTopic(session);
      const tg = await telegramSendLive(
        session,
        [
          '👤 Live chat request — Stand Law Firm',
          '',
          `Name: ${visitorName}`,
          `Reason: ${visitorReason}`,
          `Session: ${sessionId}`,
          '',
          'Accept (or) Decline?',
        ].join('\n'),
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Accept Chat', callback_data: `live_accept:${sessionId}` },
                { text: '❌ Decline Chat', callback_data: `live_reject:${sessionId}` },
              ],
            ],
          },
        }
      );
      session.notifyMessageId = tg.result.message_id;
      registerTelegramMessage(session, tg.result.message_id);
      saveSession(session);
      trackChat('live_started', { sessionId });
      send(res, 200, { ok: true, sessionId, status: session.status });
    } catch (err) {
      console.error('Live request failed:', err.message);
      send(res, 502, { error: 'Could not reach the office. Please try again.' });
    }
  }

  async function handleLiveMessage(req, res) {
    if (!rateLiveMessage(clientIp(req))) {
      send(res, 429, { error: 'Too many requests. Please try again shortly.' });
      return;
    }

    const body = await parseBody(req);
    const sessionId = cleanText(body.sessionId, 64);
    const message = cleanText(body.message, 2000);
    if (!sessionId || !message) {
      send(res, 400, { error: 'Session and message are required.' });
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      send(res, 404, { error: 'Session not found.' });
      return;
    }
    if (session.status !== 'active') {
      send(res, 409, { error: 'Session is not active.', status: session.status });
      return;
    }

    pushMessage(session, 'user', message);
    setFocusedSession(sessionId);
    saveSession(session);

    let telegramOk = false;
    try {
      const tg = await telegramSendLive(session, `👤 Visitor:\n${message}`, {
        reply_markup: liveChatCloseInline(session.id),
      });
      registerTelegramMessage(session, tg.result.message_id);
      saveSession(session);
      telegramOk = true;
    } catch (err) {
      console.error('Live message failed:', err.message);
    }

    send(res, 200, { ok: true, telegramOk });
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

  async function handleSessionPoll(req, res, sessionId) {
    if (!rateSessionPoll(clientIp(req))) {
      send(res, 429, { error: 'Too many requests. Please try again shortly.' });
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);

    const session = getSession(sessionId);
    if (!session) {
      send(res, 404, { error: 'Session not found.' });
      return;
    }

    const slice = session.messages.slice(since);
    send(res, 200, {
      ok: true,
      sessionId: session.id,
      status: session.status,
      messages: slice,
      nextIndex: since + slice.length,
    });
  }

  function handleSessionStream(req, res, sessionId) {
    if (!rateSessionPoll(clientIp(req))) {
      send(res, 429, { error: 'Too many requests. Please try again shortly.' });
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      send(res, 404, { error: 'Session not found.' });
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    let cursor = Math.max(0, Number(url.searchParams.get('since')) || 0);

    const headers = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (typeof buildApiHeaders === 'function') {
      Object.assign(headers, buildApiHeaders(req, 'text/event-stream; charset=utf-8'));
      headers['Content-Type'] = 'text/event-stream; charset=utf-8';
      headers['Cache-Control'] = 'no-cache, no-transform';
      delete headers['Content-Length'];
    }

    res.writeHead(200, headers);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    if (!streamSubscribers.has(sessionId)) streamSubscribers.set(sessionId, new Set());
    streamSubscribers.get(sessionId).add(res);

    const sendEvent = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* closed */
      }
    };

    sendEvent({
      ok: true,
      sessionId: session.id,
      status: session.status,
      messages: session.messages.slice(cursor),
      nextIndex: session.messages.length,
      full: true,
    });
    cursor = session.messages.length;

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);

    const onClose = () => {
      clearInterval(heartbeat);
      const set = streamSubscribers.get(sessionId);
      if (set) {
        set.delete(res);
        if (!set.size) streamSubscribers.delete(sessionId);
      }
    };
    req.on('close', onClose);
    res.on('close', onClose);
  }

  async function handleLiveClose(req, res) {
    if (!checkTelegramRate(clientIp(req))) {
      send(res, 429, { error: 'Too many requests. Please try again shortly.' });
      return;
    }

    const body = await parseBody(req);
    const sessionId = cleanText(body.sessionId, 64);
    if (!sessionId) {
      send(res, 400, { error: 'Session is required.' });
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      send(res, 404, { error: 'Session not found.' });
      return;
    }
    if (session.status === 'closed' || session.status === 'rejected') {
      send(res, 200, {
        ok: true,
        status: session.status,
        message: 'ဆက်သွယ်မှု ပြီးဆုံးပါပြီ။',
      });
      return;
    }

    const ok = await closeSession(sessionId, 'visitor');
    if (!ok) {
      send(res, 409, { error: 'Could not end chat.' });
      return;
    }

    const updated = getSession(sessionId);
    const lastMsg = updated?.messages?.slice(-1)[0];
    send(res, 200, {
      ok: true,
      status: 'closed',
      message: lastMsg?.text || 'ဆက်သွယ်မှု ပြီးဆုံးပါပြီ။',
    });
  }

  function readArchiveStore() {
    const archivePath = path.join(root, ARCHIVE_FILE);
    try {
      const raw = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      return Array.isArray(raw.sessions) ? raw : { sessions: [] };
    } catch {
      return { sessions: [] };
    }
  }

  function handleChatArchiveList(req, res) {
    const archive = readArchiveStore();
    const list = archive.sessions.map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      closedAt: s.closedAt,
      closedBy: s.closedBy,
      visitorName: s.visitorName || '',
      visitorReason: s.visitorReason || '',
      messageCount: s.messageCount || (s.messages || []).length,
      preview:
        s.visitorReason ||
        (s.messages || []).find((m) => m.from === 'user')?.text?.slice(0, 100) ||
        '',
    }));
    send(res, 200, { ok: true, sessions: list });
  }

  function handleChatArchiveDetail(req, res, sessionId) {
    const archive = readArchiveStore();
    const session = archive.sessions.find((s) => s.id === sessionId);
    if (!session) {
      send(res, 404, { error: 'Archive not found.' });
      return;
    }
    send(res, 200, { ok: true, session });
  }

  async function handleTelegramWebhook(req, res) {
    try {
      const body = await parseBody(req);
      if (body) await processTelegramUpdate(body);
      send(res, 200, { ok: true });
    } catch (err) {
      console.error('Webhook error:', err.message);
      send(res, 200, { ok: true });
    }
  }

  rebuildMaps();
  pruneOldSessions();
  initFocusedSession();

  (function pruneArchiveOnStartup() {
    const archivePath = path.join(root, ARCHIVE_FILE);
    try {
      const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      if (!Array.isArray(archive.sessions)) return;
      const before = archive.sessions.length;
      pruneArchiveSessions(archive);
      if (archive.sessions.length !== before) {
        fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n', 'utf8');
      }
    } catch {
      /* no archive yet */
    }
  })();

  return {
    handleLiveRequest,
    handleLiveMessage,
    handleLiveClose,
    handleSessionPoll,
    handleSessionStream,
    handleChatArchiveList,
    handleChatArchiveDetail,
    handleTelegramWebhook,
    startTelegramPolling: pollTelegramUpdates,
    registerBotCommands,
  };
}

module.exports = { createLiveChatApi };
