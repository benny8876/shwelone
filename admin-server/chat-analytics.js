
const fs = require('fs');
const path = require('path');

const ANALYTICS_FILE = 'data/chat-analytics.json';
const RETENTION_DAYS = 90;

function createChatAnalytics({ root }) {
  const filePath = () => path.join(root, ANALYTICS_FILE);

  function yangonDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Yangon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function readStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
      return {
        events: Array.isArray(raw.events) ? raw.events : [],
      };
    } catch {
      return { events: [] };
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(store, null, 2) + '\n', 'utf8');
  }

  function prune(events) {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return events.filter((e) => {
      const t = new Date(e.at).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
  }

  function track(type, meta = {}) {
    try {
      const store = readStore();
      store.events.push({
        type: String(type || '').slice(0, 64),
        at: new Date().toISOString(),
        dateKey: yangonDateKey(),
        ...meta,
      });
      store.events = prune(store.events);
      if (store.events.length > 5000) store.events = store.events.slice(-5000);
      writeStore(store);
    } catch (err) {
      console.warn('Chat analytics track:', err.message);
    }
  }

  function buildStats() {
    const store = readStore();
    const events = prune(store.events);
    if (events.length !== store.events.length) writeStore({ events });

    const byDay = {};
    let accepted = 0;
    let rejected = 0;
    let closed = 0;
    let started = 0;
    const responseMs = [];
    const categoryClicks = {};
    const questionClicks = {};

    for (const e of events) {
      const day = e.dateKey || yangonDateKey(new Date(e.at));
      if (!byDay[day]) {
        byDay[day] = { date: day, started: 0, accepted: 0, rejected: 0, closed: 0 };
      }

      if (e.type === 'live_started') {
        started += 1;
        byDay[day].started += 1;
      } else if (e.type === 'live_accepted') {
        accepted += 1;
        byDay[day].accepted += 1;
      } else if (e.type === 'live_rejected') {
        rejected += 1;
        byDay[day].rejected += 1;
      } else if (e.type === 'live_closed') {
        closed += 1;
        byDay[day].closed += 1;
      } else if (e.type === 'first_admin_reply' && typeof e.responseMs === 'number' && e.responseMs >= 0) {
        responseMs.push(e.responseMs);
      } else if (e.type === 'faq_category') {
        const key = e.categoryId || e.label || 'unknown';
        categoryClicks[key] = (categoryClicks[key] || 0) + 1;
      } else if (e.type === 'faq_question') {
        const key = e.questionId || e.label || 'unknown';
        questionClicks[key] = (questionClicks[key] || 0) + 1;
      }
    }

    const decided = accepted + rejected;
    const acceptRate = decided ? Math.round((accepted / decided) * 1000) / 10 : 0;
    const rejectRate = decided ? Math.round((rejected / decided) * 1000) / 10 : 0;
    const avgResponseMs = responseMs.length
      ? Math.round(responseMs.reduce((a, b) => a + b, 0) / responseMs.length)
      : null;

    const daily = Object.values(byDay)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);

    const topCategories = Object.entries(categoryClicks)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topQuestions = Object.entries(questionClicks)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      ok: true,
      totals: {
        started,
        accepted,
        rejected,
        closed,
        acceptRate,
        rejectRate,
        avgResponseMs,
        avgResponseLabel: avgResponseMs == null
          ? '—'
          : avgResponseMs < 60000
            ? `${Math.round(avgResponseMs / 1000)}s`
            : `${Math.round(avgResponseMs / 60000)} min`,
      },
      daily,
      topCategories,
      topQuestions,
    };
  }

  function handleTrack(req, res, body) {
    const type = String(body?.type || '').slice(0, 64);
    if (!type) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'type required' }));
      return;
    }
    const meta = {};
    if (body.categoryId) meta.categoryId = String(body.categoryId).slice(0, 64);
    if (body.questionId) meta.questionId = String(body.questionId).slice(0, 80);
    if (body.label) meta.label = String(body.label).slice(0, 200);
    if (body.sessionId) meta.sessionId = String(body.sessionId).slice(0, 64);
    track(type, meta);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true }));
  }

  function handleStats(_req, res) {
    const stats = buildStats();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(stats));
  }

  return { track, buildStats, handleTrack, handleStats };
}

module.exports = { createChatAnalytics };
