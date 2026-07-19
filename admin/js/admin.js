/* Shwe Lone Myanmar — Admin panel (section-card editor) */
(function () {
  const ADMIN_PORT = '8790';
  const TOKEN_KEY = 'shwelone_admin_token';

  function getApiBase() {
    if (window.location.protocol === 'file:') return `http://localhost:${ADMIN_PORT}`;
    if (!window.location.port || window.location.port !== ADMIN_PORT) {
      return `http://${window.location.hostname}:${ADMIN_PORT}`;
    }
    return '';
  }

  let API = getApiBase();
  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  let insights = [];
  let policies = [];
  let editingInsightId = null;
  let editingPolicyId = null;
  let policySectionsEn = [];
  let policySectionsMm = [];
  let insightSections = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function bind(sel, event, handler) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (el) el.addEventListener(event, handler);
    return el;
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(API + path, { ...opts, headers });
    } catch {
      throw new Error(`Cannot reach admin server. Open http://localhost:${ADMIN_PORT}/admin/ and run: node admin-server/server.js`);
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      if (res.status === 404 && path === '/api/upload') {
        throw new Error('Upload API missing. Restart server: Ctrl+C then node admin-server/server.js');
      }
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function showLogin() {
    if ($('#login-screen')) $('#login-screen').hidden = false;
    if ($('#app')) $('#app').hidden = true;
  }

  function showApp() {
    if ($('#login-screen')) $('#login-screen').hidden = true;
    if ($('#app')) $('#app').hidden = false;
  }

  function setCoverPreview(url, meta) {
    const preview = $('#ins-image-preview');
    const img = $('#ins-image-preview-img');
    const clearBtn = $('#ins-image-clear');
    const hidden = $('#ins-image');
    const thumbEl = $('#ins-image-thumb');
    const portraitEl = $('#ins-image-portrait');
    if (hidden) hidden.value = url || '';
    if (url) {
      if (img) img.src = url.startsWith('http') || url.startsWith('data:') || url.startsWith('/') ? url : `../${url}`;
      if (preview) preview.hidden = false;
      if (clearBtn) clearBtn.hidden = false;
      if (meta) {
        if (thumbEl && meta.thumbUrl !== undefined) thumbEl.value = meta.thumbUrl || '';
        if (portraitEl && meta.isPortrait !== undefined) portraitEl.value = meta.isPortrait ? '1' : '';
      }
    } else {
      if (img) img.removeAttribute('src');
      if (preview) preview.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      if (thumbEl) thumbEl.value = '';
      if (portraitEl) portraitEl.value = '';
    }
  }

  async function uploadImageFile(file) {
    if (!file) return null;
    if (file.size > 6e6) throw new Error('Image must be under 6MB');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
    const data = await api('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, name: file.name }),
    });
    return data;
  }

  async function loadSiteSettings() {
    try {
      const data = await api('/api/site-settings');
      const cb = $('#setting-watermark');
      if (cb) cb.checked = data.imageWatermark !== false;
    } catch (_) {}
  }

  function setStatus(el, msg, ok) {
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
    el.className = 'form-status ' + (ok ? 'ok' : 'err');
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(iso))
      ? new Date(`${iso}T00:00:00`)
      : new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    if (/T\d{2}:/.test(String(iso))) {
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'insight';
  }

  /* ——— Date helpers ——— */
  function displayToIso(display) {
    if (!display) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(display)) return display;
    const d = new Date(display);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function isoToDisplay(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function parseLegalMeta(meta) {
    if (!meta) return { dateIso: '', subtitle: '' };
    const withoutPrefix = meta.replace(/^Last updated:\s*/i, '').trim();
    const parts = withoutPrefix.split('·').map((s) => s.trim());
    return { dateIso: displayToIso(parts[0] || ''), subtitle: parts.slice(1).join(' · ') };
  }

  function buildLegalMeta(dateIso, subtitle) {
    let meta = `Last updated: ${isoToDisplay(dateIso)}`;
    if (subtitle && subtitle.trim()) meta += ` · ${subtitle.trim()}`;
    return meta;
  }

  /* ——— Plain text ↔ HTML ——— */
  function htmlToPlain(el) {
    if (!el) return '';
    if (el.nodeType === 3) return el.textContent;
    if (el.nodeName === 'BR') return '\n';
    if (el.nodeName === 'A') return el.textContent;
    let out = '';
    el.childNodes.forEach((child) => {
      out += htmlToPlain(child);
    });
    return out;
  }

  function htmlToSections(html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html || '';
    const secs = wrap.querySelectorAll('section');
    if (!secs.length) {
      const text = wrap.textContent.trim();
      return text ? [{ title: '', body: text }] : [];
    }
    return Array.from(secs).map((sec) => {
      const h2 = sec.querySelector(':scope > h2');
      const title = h2 ? h2.textContent.trim() : '';
      const parts = [];
      Array.from(sec.children).forEach((child) => {
        if (child.nodeName === 'H2') return;
        if (child.nodeName === 'H3') {
          parts.push('### ' + child.textContent.trim());
          return;
        }
        if (child.nodeName === 'UL' || child.nodeName === 'OL') {
          child.querySelectorAll(':scope > li').forEach((li) => {
            parts.push('- ' + htmlToPlain(li).trim());
          });
          parts.push('');
          return;
        }
        if (child.nodeName === 'P') {
          parts.push(htmlToPlain(child).trim());
          parts.push('');
        }
      });
      return { title, body: parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
    });
  }

  function bodyToHtml(body) {
    const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }
      if (/^###\s+/.test(line.trim())) {
        blocks.push(`<h3>${esc(line.trim().replace(/^###\s+/, ''))}</h3>`);
        i += 1;
        continue;
      }
      if (/^[-•*]\s+/.test(line.trim())) {
        const items = [];
        while (i < lines.length && /^[-•*]\s+/.test(lines[i].trim())) {
          items.push(`<li>${esc(lines[i].trim().replace(/^[-•*]\s+/, ''))}</li>`);
          i += 1;
        }
        blocks.push(`<ul>\n${items.join('\n')}\n</ul>`);
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^[-•*]\s+/.test(lines[i].trim()) && !/^###\s+/.test(lines[i].trim())) {
        para.push(lines[i].trim());
        i += 1;
      }
      blocks.push(`<p>${esc(para.join(' '))}</p>`);
    }
    return blocks.join('\n');
  }

  function sectionsToHtml(sections) {
    return (sections || [])
      .filter((s) => (s.title && s.title.trim()) || (s.body && s.body.trim()))
      .map((s) => {
        const title = (s.title || '').trim() || 'Section';
        const bodyHtml = bodyToHtml(s.body);
        return `<section>\n          <h2>${esc(title)}</h2>\n          ${bodyHtml}\n        </section>`;
      })
      .join('\n');
  }

  function insightSectionsToHtml(sections) {
    return (sections || [])
      .filter((s) => (s.title && s.title.trim()) || (s.body && s.body.trim()))
      .map((s) => {
        let html = '';
        if (s.title && s.title.trim()) html += `<h2>${esc(s.title.trim())}</h2>`;
        html += bodyToHtml(s.body);
        return html;
      })
      .join('\n');
  }

  function htmlToInsightSections(html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html || '';
    const children = Array.from(wrap.children);
    if (!children.length) {
      const t = wrap.textContent.trim();
      return t ? [{ title: '', body: t }] : [{ title: '', body: '' }];
    }
    const sections = [];
    let current = { title: '', bodyParts: [] };
    function flush() {
      const body = current.bodyParts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (current.title || body) sections.push({ title: current.title, body });
      current = { title: '', bodyParts: [] };
    }
    children.forEach((child) => {
      if (child.nodeName === 'H2') {
        flush();
        current.title = child.textContent.trim();
        return;
      }
      if (child.nodeName === 'H3') {
        current.bodyParts.push('### ' + child.textContent.trim(), '');
        return;
      }
      if (child.nodeName === 'UL' || child.nodeName === 'OL') {
        child.querySelectorAll(':scope > li').forEach((li) => {
          current.bodyParts.push('- ' + htmlToPlain(li).trim());
        });
        current.bodyParts.push('');
        return;
      }
      if (child.nodeName === 'P') {
        current.bodyParts.push(htmlToPlain(child).trim(), '');
      }
    });
    flush();
    return sections.length ? sections : [{ title: '', body: '' }];
  }

  /* ——— Section board UI ——— */
  function readSectionsFromBoard(board) {
    if (!board) return [];
    return Array.from(board.querySelectorAll('.section-card')).map((card) => ({
      title: card.querySelector('.sec-title')?.value || '',
      body: card.querySelector('.sec-body')?.value || '',
    }));
  }

  function renderSectionBoard(board, sections, opts = {}) {
    if (!board) return;
    const list = sections.length ? sections : [{ title: '', body: '' }];
    board.innerHTML = list
      .map(
        (sec, i) => `
      <article class="section-card" data-index="${i}">
        <div class="section-card-top">
          <span class="section-num">${i + 1}</span>
          <input type="text" class="sec-title" placeholder="${opts.titlePlaceholder || 'Section heading'}" value="${esc(sec.title || '')}" />
          <button type="button" class="btn-icon btn-icon-danger" data-remove title="Remove">✕</button>
        </div>
        <textarea class="sec-body" rows="4" placeholder="${opts.bodyPlaceholder || 'Write the section content…\n\nFor a list, start lines with:\n- Item one\n- Item two'}">${esc(sec.body || '')}</textarea>
      </article>`
      )
      .join('');

    board.querySelectorAll('.section-card').forEach((card) => {
      const idx = Number(card.dataset.index);
      card.querySelector('[data-remove]')?.addEventListener('click', () => {
        let arr = readSectionsFromBoard(board);
        arr.splice(idx, 1);
        if (!arr.length) arr = [{ title: '', body: '' }];
        renderSectionBoard(board, arr, opts);
      });
    });
  }

  function addSection(board, opts) {
    const arr = readSectionsFromBoard(board);
    arr.push({ title: '', body: '' });
    renderSectionBoard(board, arr, opts);
    const last = board.querySelector('.section-card:last-child .sec-title');
    if (last) last.focus();
  }

  /* ——— Views ——— */
  const views = {
    insights: { el: '#view-insights', title: 'Insights' },
    'insight-edit': { el: '#view-insight-edit', title: 'Edit insight' },
    policies: { el: '#view-policies', title: 'Policies' },
    'policy-edit': { el: '#view-policy-edit', title: 'Edit policy' },
    chats: { el: '#view-chats', title: 'Chat history' },
    'chat-detail': { el: '#view-chat-detail', title: 'Chat session' },
    visitors: { el: '#view-visitors', title: 'Visitors' },
    settings: { el: '#view-settings', title: 'Settings' },
  };

  function showView(name) {
    Object.entries(views).forEach(([key, v]) => {
      const el = $(v.el);
      if (el) el.hidden = key !== name;
    });
    const title = $('#view-title');
    if (title) title.textContent = views[name]?.title || 'Admin';
    $$('.nav-item').forEach((btn) => {
        btn.classList.toggle(
        'is-active',
        btn.dataset.view === name ||
          (name === 'insight-edit' && btn.dataset.view === 'insights') ||
          (name === 'policy-edit' && btn.dataset.view === 'policies') ||
          (name === 'chat-detail' && btn.dataset.view === 'chats')
      );
    });
  }

  function switchEditorLang(lang) {
    $$('.editor-lang-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.editorLang === lang);
    });
    $$('.rich-editor-panel').forEach((panel) => {
      const on = panel.dataset.editorPanel === lang;
      panel.hidden = !on;
      panel.classList.toggle('is-active', on);
    });
  }

  /* ——— Auth ——— */
  async function handleLogin() {
    const errEl = $('#login-error');
    const btn = $('#login-btn');
    const pwInput = $('#password');
    if (!pwInput) return;
    const pw = pwInput.value;
    if (!pw) {
      if (errEl) {
        errEl.textContent = 'Please enter your password.';
        errEl.hidden = false;
      }
      return;
    }
    if (errEl) errEl.hidden = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Signing in…';
    }
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      showApp();
      await loadInsights();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Login failed';
        errEl.hidden = false;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }
  }

  async function checkSession() {
    try {
      const data = await api('/api/session');
      if (data.authed) {
        showApp();
        await loadInsights();
        return;
      }
    } catch (_) {}
    showLogin();
  }

  /* ——— Insights ——— */
  async function loadInsights() {
    const data = await api('/api/insights');
    insights = data.insights || [];
    renderInsightsList();
  }

  function renderInsightsList() {
    const list = $('#insights-list');
    if (!list) return;
    if (!insights.length) {
      list.innerHTML = '<p class="view-hint">No insights yet. Click “New insight” to create one.</p>';
      return;
    }
    list.innerHTML = insights
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(
        (item) => `
      <div class="data-row">
        <div class="data-row-main">
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.excerpt || '')}</p>
          <p class="data-row-meta">${esc(item.category || '')} · ${formatDate(item.date || '')}</p>
        </div>
        <div class="data-row-actions">
          <span class="badge ${item.published ? 'badge-live' : 'badge-draft'}">${item.published ? 'Published' : 'Draft'}</span>
          <button type="button" class="btn btn-outline" data-edit-insight="${esc(item.id)}">Edit</button>
        </div>
      </div>`
      )
      .join('');

    list.querySelectorAll('[data-edit-insight]').forEach((btn) => {
      btn.addEventListener('click', () => openInsightEditor(btn.dataset.editInsight));
    });
  }

  function openInsightEditor(id) {
    editingInsightId = id || null;
    const item = id ? insights.find((i) => i.id === id) : null;
    $('#ins-title').value = item?.title || '';
    $('#ins-category').value = item?.category || 'Corporate';
    $('#ins-date').value = item?.date || new Date().toISOString().slice(0, 10);
    $('#ins-excerpt').value = item?.excerpt || '';
    $('#ins-lead').value = item?.lead || '';
    const cover = item?.image || '';
    setCoverPreview(cover, {
      thumbUrl: item?.imageThumb || '',
      isPortrait: !!item?.imagePortrait,
    });
    const urlInput = $('#ins-image-url');
    if (urlInput) {
      urlInput.value = cover && /^https?:\/\//i.test(cover) ? cover : '';
    }
    $('#ins-published').checked = item ? !!item.published : true;
    const del = $('#delete-insight-btn');
    if (del) del.hidden = !item;
    insightSections = htmlToInsightSections(item?.body || '');
    renderSectionBoard($('#ins-sections'), insightSections, {
      titlePlaceholder: 'Section heading (optional)',
      bodyPlaceholder: 'Write content…\n\nFor a list:\n- Item one\n- Item two',
    });
    setStatus($('#insight-status'), '', true);
    showView('insight-edit');
  }

  /* ——— Policies ——— */
  async function loadPolicies() {
    const data = await api('/api/policies');
    policies = data.policies || [];
    renderPoliciesList();
  }

  function renderPoliciesList() {
    const list = $('#policies-list');
    if (!list) return;
    list.innerHTML = policies
      .map(
        (p) => `
      <div class="data-row">
        <div class="data-row-main">
          <h3>${esc(p.title)}</h3>
          <p class="data-row-meta">${esc(p.file)}</p>
        </div>
        <div class="data-row-actions">
          <button type="button" class="btn btn-outline" data-edit-policy="${esc(p.id)}">Edit</button>
        </div>
      </div>`
      )
      .join('');

    list.querySelectorAll('[data-edit-policy]').forEach((btn) => {
      btn.addEventListener('click', () => openPolicyEditor(btn.dataset.editPolicy));
    });
  }

  async function openPolicyEditor(id) {
    editingPolicyId = id;
    const data = await api(`/api/policies/${encodeURIComponent(id)}`);
    const meta = parseLegalMeta(data.legalMeta || '');
    $('#pol-title').value = data.title || '';
    $('#pol-updated').value = meta.dateIso || new Date().toISOString().slice(0, 10);
    $('#pol-meta-sub').value = meta.subtitle;
    $('#pol-lead').value = data.lead || '';
    $('#pol-org').value = data.org || '';
    policySectionsEn = htmlToSections(data.bodyEn || '');
    policySectionsMm = htmlToSections(data.bodyMm || '');
    if (!policySectionsEn.length) policySectionsEn = [{ title: '', body: '' }];
    if (!policySectionsMm.length) policySectionsMm = [{ title: '', body: '' }];
    renderSectionBoard($('#pol-sections-en'), policySectionsEn);
    renderSectionBoard($('#pol-sections-mm'), policySectionsMm);
    const preview = $('#policy-preview');
    if (preview) preview.href = `../${data.file}`;
    setStatus($('#policy-status'), '', true);
    switchEditorLang('en');
    showView('policy-edit');
  }

  /* ——— Chat archive ——— */
  let chatArchive = [];

  async function loadChatArchive() {
    const data = await api('/api/chat/archive');
    chatArchive = data.sessions || [];
    renderChatArchiveList();
  }

  function renderChatArchiveList() {
    const list = $('#chats-list');
    if (!list) return;
    if (!chatArchive.length) {
      list.innerHTML = '<p class="view-hint">No archived chats yet.</p>';
      return;
    }
    list.innerHTML = chatArchive
      .map(
        (item) => `
      <div class="data-row">
        <div class="data-row-main">
          <h3>${esc(item.visitorName || 'Visitor')} — ${esc(item.id)}</h3>
          <p>${esc(item.preview || '—')}</p>
          <p class="data-row-meta">${esc(item.status || '')} · ${item.messageCount || 0} messages · closed ${formatDate(item.closedAt || '')} · by ${esc(item.closedBy || '')}</p>
        </div>
        <div class="data-row-actions">
          <button type="button" class="btn btn-outline" data-view-chat="${esc(item.id)}">View</button>
        </div>
      </div>`
      )
      .join('');

    list.querySelectorAll('[data-view-chat]').forEach((btn) => {
      btn.addEventListener('click', () => openChatArchive(btn.dataset.viewChat));
    });
  }

  async function openChatArchive(id) {
    const data = await api(`/api/chat/archive/${encodeURIComponent(id)}`);
    const session = data.session;
    const detail = $('#chat-detail');
    if (!detail || !session) return;

    const rows = (session.messages || [])
      .map((msg) => {
        const who =
          msg.from === 'admin'
            ? 'Office'
            : msg.from === 'user'
              ? 'Visitor'
              : 'System';
        return `<div class="chat-archive-msg is-${esc(msg.from)}">
          <span class="chat-archive-who">${esc(who)}</span>
          <span class="chat-archive-time">${formatDate(msg.at || '')}</span>
          <p>${esc(msg.text || '')}</p>
        </div>`;
      })
      .join('');

    detail.innerHTML = `
      <div class="settings-card">
        <h3>${esc(session.visitorName || 'Visitor')}</h3>
        <p class="data-row-meta">Session ${esc(session.id)} · ${esc(session.status)} · ${(session.messages || []).length} messages · closed ${formatDate(session.closedAt || '')}</p>
        ${session.visitorReason ? `<p><strong>Reason:</strong> ${esc(session.visitorReason)}</p>` : ''}
        <div class="chat-archive-thread">${rows || '<p class="view-hint">No messages.</p>'}</div>
      </div>`;
    showView('chat-detail');
  }

  /* ——— Visitor analytics ——— */
  function renderBreakdownList(items, emptyLabel) {
    if (!items || !items.length) return `<p class="view-hint">${emptyLabel}</p>`;
    return items
      .map(
        (item) => `
      <div class="breakdown-row">
        <span>${esc(item.name)}</span>
        <strong>${item.count}</strong>
      </div>`
      )
      .join('');
  }

  async function loadVisitorStats() {
    const data = await api('/api/analytics/stats');
    const t = data.totals || {};
    const stats = $('#visitors-stats');
    if (stats) {
      stats.innerHTML = `
        <div class="stat-card">
          <p class="stat-label">Today</p>
          <p class="stat-value">${t.todayPageviews || 0}</p>
          <p class="stat-sub">${t.todayUnique || 0} unique visitors</p>
        </div>
        <div class="stat-card">
          <p class="stat-label">Last 7 days</p>
          <p class="stat-value">${t.last7Pageviews || 0}</p>
          <p class="stat-sub">${t.last7Unique || 0} unique</p>
        </div>
        <div class="stat-card">
          <p class="stat-label">Last 30 days</p>
          <p class="stat-value">${t.last30Pageviews || 0}</p>
          <p class="stat-sub">${t.last30Unique || 0} unique</p>
        </div>
        <div class="stat-card">
          <p class="stat-label">All time</p>
          <p class="stat-value">${t.pageviews || 0}</p>
          <p class="stat-sub">${t.uniqueVisitors || 0} unique (daily)</p>
        </div>`;
    }

    const breakdown = $('#visitors-breakdown');
    if (breakdown) {
      breakdown.innerHTML = `
        <div>
          <h4>Device</h4>
          ${renderBreakdownList(data.devices, 'No data yet')}
        </div>
        <div>
          <h4>Browser</h4>
          ${renderBreakdownList(data.browsers, 'No data yet')}
        </div>
        <div>
          <h4>OS</h4>
          ${renderBreakdownList(data.os, 'No data yet')}
        </div>`;
    }

    const pages = $('#visitors-pages');
    if (pages) {
      pages.innerHTML = renderBreakdownList(data.topPages, 'No page views yet');
    }

    const referrers = $('#visitors-referrers');
    if (referrers) {
      referrers.innerHTML = renderBreakdownList(data.referrers, 'No referrers yet');
    }

    const recent = $('#visitors-recent');
    if (recent) {
      const rows = data.recent || [];
      if (!rows.length) {
        recent.innerHTML = '<p class="view-hint">No visits recorded yet. Open the site in a browser to test.</p>';
      } else {
        recent.innerHTML = rows
          .map(
            (row) => `
          <div class="data-row">
            <div class="data-row-main">
              <h3>${esc(row.path)}</h3>
              <p>${esc(row.device)} · ${esc(row.browser)} · ${esc(row.os)}${row.screen ? ` · ${esc(row.screen)}` : ''}</p>
              <p class="data-row-meta">${formatDate(row.at)} · from ${esc(row.referrer || 'direct')}</p>
            </div>
          </div>`
          )
          .join('');
      }
    }
  }

  function closeSidebar() {
    const sidebar = $('#admin-sidebar');
    const overlay = $('#sidebar-overlay');
    const toggle = $('#sidebar-toggle');
    sidebar?.classList.remove('is-open');
    overlay?.classList.remove('is-visible');
    if (overlay) overlay.hidden = true;
    toggle?.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('admin-sidebar-open');
  }

  function openSidebar() {
    const sidebar = $('#admin-sidebar');
    const overlay = $('#sidebar-overlay');
    const toggle = $('#sidebar-toggle');
    sidebar?.classList.add('is-open');
    overlay?.classList.add('is-visible');
    if (overlay) {
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
    }
    toggle?.classList.add('is-open');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
    }
    document.body.classList.add('admin-sidebar-open');
  }

  function toggleSidebar() {
    if ($('#admin-sidebar')?.classList.contains('is-open')) closeSidebar();
    else openSidebar();
  }

  function initMobileNav() {
    bind('#sidebar-toggle', 'click', toggleSidebar);
    bind('#sidebar-overlay', 'click', closeSidebar);
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) closeSidebar();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSidebar();
    });
  }

  /* ——— Init ——— */
  function init() {
    if (window.location.protocol === 'file:') {
      window.location.replace(`http://localhost:${ADMIN_PORT}/admin/`);
      return;
    }
    API = getApiBase();

    bind('#login-form', 'submit', (e) => {
      e.preventDefault();
      handleLogin();
    });
    bind('#login-btn', 'click', (e) => {
      e.preventDefault();
      handleLogin();
    });

    bind('#logout-btn', 'click', async () => {
      try {
        await api('/api/logout', { method: 'POST' });
      } catch (_) {}
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      showLogin();
    });

    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === 'insights') loadInsights();
        if (view === 'policies') loadPolicies();
        if (view === 'chats') loadChatArchive();
        if (view === 'visitors') loadVisitorStats();
        if (view === 'settings') loadSiteSettings();
        showView(view);
        closeSidebar();
      });
    });

    initMobileNav();

    bind('#ins-image-pick', 'click', () => {
      $('#ins-image-file')?.click();
    });

    bind('#ins-image-file', 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const status = $('#insight-status');
      try {
        setStatus(status, 'Uploading…', true);
        const data = await uploadImageFile(file);
        setCoverPreview(data.url, {
          thumbUrl: data.thumbUrl || '',
          isPortrait: !!data.isPortrait,
        });
        const urlInput = $('#ins-image-url');
        if (urlInput) urlInput.value = '';
        const portraitNote = data.isPortrait ? ' A4 layout applied on article page.' : '';
        setStatus(status, (data.watermarked !== false ? 'Image uploaded with logo watermark.' : 'Image uploaded.') + portraitNote, true);
      } catch (err) {
        setStatus(status, err.message, false);
      }
      e.target.value = '';
    });

    bind('#ins-image-clear', 'click', () => {
      setCoverPreview('');
      const urlInput = $('#ins-image-url');
      if (urlInput) urlInput.value = '';
    });

    bind('#ins-image-url', 'change', () => {
      const url = $('#ins-image-url').value.trim();
      if (url) setCoverPreview(url, { thumbUrl: '', isPortrait: false });
    });

    bind('#site-settings-form', 'submit', async (e) => {
      e.preventDefault();
      const status = $('#site-settings-status');
      try {
        await api('/api/site-settings', {
          method: 'PUT',
          body: JSON.stringify({
            imageWatermark: $('#setting-watermark').checked,
          }),
        });
        setStatus(status, 'Settings saved.', true);
      } catch (err) {
        setStatus(status, err.message, false);
      }
    });

    bind('#new-insight-btn', 'click', () => openInsightEditor(null));
    bind('#insight-back', 'click', () => {
      showView('insights');
      loadInsights();
    });
    bind('#ins-add-section', 'click', () => addSection($('#ins-sections')));

    bind('#insight-form', 'submit', async (e) => {
      e.preventDefault();
      const status = $('#insight-status');
      insightSections = readSectionsFromBoard($('#ins-sections'));
      const item = {
        id: editingInsightId || slugify($('#ins-title').value),
        slug: editingInsightId || slugify($('#ins-title').value),
        title: $('#ins-title').value.trim(),
        category: $('#ins-category').value.trim(),
        date: $('#ins-date').value,
        excerpt: $('#ins-excerpt').value.trim(),
        lead: $('#ins-lead').value.trim(),
        image: $('#ins-image').value.trim(),
        imageAlt: $('#ins-title').value.trim(),
        body: insightSectionsToHtml(insightSections),
        published: $('#ins-published').checked,
      };
      const thumb = $('#ins-image-thumb')?.value.trim();
      if (thumb) item.imageThumb = thumb;
      if ($('#ins-image-portrait')?.value === '1') item.imagePortrait = true;
      const idx = insights.findIndex((i) => i.id === item.id);
      if (idx >= 0) insights[idx] = item;
      else insights.push(item);
      try {
        await api('/api/insights', { method: 'PUT', body: JSON.stringify({ insights }) });
        editingInsightId = item.id;
        if ($('#delete-insight-btn')) $('#delete-insight-btn').hidden = false;
        setStatus(status, 'Saved.', true);
      } catch (err) {
        setStatus(status, err.message, false);
      }
    });

    bind('#delete-insight-btn', 'click', async () => {
      if (!editingInsightId || !confirm('Delete this insight?')) return;
      insights = insights.filter((i) => i.id !== editingInsightId);
      try {
        await api('/api/insights', { method: 'PUT', body: JSON.stringify({ insights }) });
        showView('insights');
        loadInsights();
      } catch (err) {
        setStatus($('#insight-status'), err.message, false);
      }
    });

    bind('#policy-back', 'click', () => {
      showView('policies');
      loadPolicies();
    });

    bind('#chat-back', 'click', () => {
      showView('chats');
      loadChatArchive();
    });

    $$('.editor-lang-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchEditorLang(tab.dataset.editorLang));
    });

    bind('#pol-add-en', 'click', () => addSection($('#pol-sections-en')));
    bind('#pol-add-mm', 'click', () => addSection($('#pol-sections-mm')));

    bind('#policy-form', 'submit', async (e) => {
      e.preventDefault();
      const status = $('#policy-status');
      policySectionsEn = readSectionsFromBoard($('#pol-sections-en'));
      policySectionsMm = readSectionsFromBoard($('#pol-sections-mm'));
      try {
        await api(`/api/policies/${encodeURIComponent(editingPolicyId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: $('#pol-title').value.trim(),
            legalMeta: buildLegalMeta($('#pol-updated').value, $('#pol-meta-sub').value),
            lead: $('#pol-lead').value.trim(),
            org: $('#pol-org').value.trim(),
            bodyEn: sectionsToHtml(policySectionsEn),
            bodyMm: sectionsToHtml(policySectionsMm),
          }),
        });
        setStatus(status, 'Saved.', true);
      } catch (err) {
        setStatus(status, err.message, false);
      }
    });

    bind('#password-form', 'submit', async (e) => {
      e.preventDefault();
      const status = $('#password-status');
      try {
        await api('/api/change-password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: $('#cur-password').value,
            newPassword: $('#new-password').value,
          }),
        });
        $('#cur-password').value = '';
        $('#new-password').value = '';
        setStatus(status, 'Password updated.', true);
      } catch (err) {
        setStatus(status, err.message, false);
      }
    });

    checkSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
