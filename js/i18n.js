
(function () {
  const STORAGE_KEY = 'site-lang';
  const DEFAULT_LANG = 'en';
  const cache = new Map();

  let data = null;

  function getLang() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'mm' ? 'mm' : DEFAULT_LANG;
  }

  function basePath() {
    return document.body?.dataset?.i18nBase || '';
  }

  async function loadData() {
    if (data) return data;
    try {
      const res = await fetch(`${basePath()}data/i18n.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('i18n load failed');
      data = await res.json();
    } catch (err) {
      console.warn('i18n:', err.message);
      data = { strings: {}, pages: {}, meta: {} };
    }
    return data;
  }

  function t(key, lang) {
    const entry = data?.strings?.[key];
    if (!entry) return null;
    return entry[lang] ?? entry.en ?? null;
  }

  function nodeId(el) {
    if (!el.dataset.i18nId) el.dataset.i18nId = `n${cache.size}`;
    return el.dataset.i18nId;
  }

  function applyStrings(lang) {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const cacheKey = `${nodeId(el)}:text`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, el.textContent);
      if (lang === 'en') {
        el.textContent = cache.get(cacheKey);
        return;
      }
      const val = t(el.dataset.i18n, lang);
      if (val != null) el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const cacheKey = `${nodeId(el)}:html`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, el.innerHTML);
      if (lang === 'en') {
        el.innerHTML = cache.get(cacheKey);
        return;
      }
      const val = t(el.dataset.i18nHtml, lang);
      if (val != null) el.innerHTML = val;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const cacheKey = `${nodeId(el)}:placeholder`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, el.placeholder);
      if (lang === 'en') {
        el.placeholder = cache.get(cacheKey);
        return;
      }
      const val = t(el.dataset.i18nPlaceholder, lang);
      if (val != null) el.placeholder = val;
    });

    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const cacheKey = `${nodeId(el)}:aria`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, el.getAttribute('aria-label') || '');
      if (lang === 'en') {
        el.setAttribute('aria-label', cache.get(cacheKey));
        return;
      }
      const val = t(el.dataset.i18nAria, lang);
      if (val != null) el.setAttribute('aria-label', val);
    });
  }

  function resolveProp(el, entry) {
    if (entry.attr) return entry.attr;
    if (entry.html) return 'html';
    if (el.tagName === 'OPTGROUP') return 'label';
    return 'text';
  }

  function readI18nValue(el, prop) {
    if (prop === 'html') return el.innerHTML;
    if (prop === 'label') return el.getAttribute('label') || '';
    if (prop === 'placeholder') return el.placeholder;
    return el.textContent;
  }

  function writeI18nValue(el, prop, val) {
    if (prop === 'html') el.innerHTML = val;
    else if (prop === 'label') el.setAttribute('label', val);
    else if (prop === 'placeholder') el.placeholder = val;
    else el.textContent = val;
  }

  function applyPageSelectors(page, lang) {
    const entries = data?.pages?.[page];
    if (!Array.isArray(entries)) return;

    entries.forEach((entry, idx) => {
      document.querySelectorAll(entry.sel).forEach((el, elIdx) => {
        const prop = resolveProp(el, entry);
        const cacheKey = `page:${page}:${idx}:${elIdx}:${prop}`;
        if (!cache.has(cacheKey)) {
          cache.set(cacheKey, readI18nValue(el, prop));
        }
        if (lang === 'en') {
          const orig = cache.get(cacheKey);
          if (orig != null) writeI18nValue(el, prop, orig);
          return;
        }
        const val = entry.mm;
        if (val == null) return;
        writeI18nValue(el, prop, val);
      });
    });

    syncMarqueeClone();
  }

  function syncMarqueeClone() {
    const groups = document.querySelectorAll('.marquee-track .marquee-group');
    if (groups.length < 2) return;
    groups[1].innerHTML = groups[0].innerHTML;
  }

  function applyMeta(lang) {
    const page = document.body?.dataset?.i18nPage;
    const titleKey = document.body?.dataset?.i18nTitle;
    if (titleKey) {
      const val = t(titleKey, lang) || data?.meta?.[page]?.[lang];
      if (val) document.title = val;
    }
    const descKey = document.body?.dataset?.i18nDesc;
    if (descKey) {
      const val = t(descKey, lang);
      const meta = document.querySelector('meta[name="description"]');
      if (val && meta) meta.content = val;
    }
  }

  function syncLegalPanels(lang) {
    const tabs = document.querySelectorAll('.lang-tab[data-lang]');
    const panels = document.querySelectorAll('.legal-body[data-panel]');
    if (!tabs.length || !panels.length) return;
    tabs.forEach((tab) => {
      const on = tab.getAttribute('data-lang') === lang;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      const show = panel.getAttribute('data-panel') === lang;
      if (show) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    });
  }

  function updateToggle(lang) {
    document.querySelectorAll('.site-lang-btn').forEach((btn) => {
      const on = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function injectToggle() {
    if (document.querySelector('.site-lang-toggle')) return;
    const navEnd = document.querySelector('.nav-end');
    if (!navEnd) return;
    const wrap = document.createElement('div');
    wrap.className = 'site-lang-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Language');
    wrap.innerHTML =
      '<button type="button" class="site-lang-btn" data-lang="en">EN</button>' +
      '<button type="button" class="site-lang-btn" data-lang="mm">MM</button>';
    navEnd.insertBefore(wrap, navEnd.firstChild);
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.site-lang-btn');
      if (!btn) return;
      setLang(btn.getAttribute('data-lang'));
    });
  }

  function applyLang(lang) {
    const page = document.body?.dataset?.i18nPage || 'common';
    applyStrings(lang);
    applyPageSelectors(page, lang);
    applyPageSelectors('common', lang);
    applyMeta(lang);
    syncLegalPanels(lang);
    updateToggle(lang);
    document.documentElement.lang = lang === 'mm' ? 'my' : 'en';
    document.documentElement.classList.toggle('lang-mm', lang === 'mm');
    document.documentElement.classList.toggle('lang-en', lang !== 'mm');
    window.dispatchEvent(new CustomEvent('site-lang-change', { detail: { lang } }));
  }

  function setLang(lang) {
    const next = lang === 'mm' ? 'mm' : 'en';
    localStorage.setItem(STORAGE_KEY, next);
    applyLang(next);
  }

  function wireLegalTabs() {
    document.querySelectorAll('.lang-tab[data-lang]').forEach((tab) => {
      tab.addEventListener('click', () => {
        setLang(tab.getAttribute('data-lang'));
      });
    });
  }

  async function init() {
    await loadData();
    injectToggle();
    wireLegalTabs();
    applyLang(getLang());
  }

  window.SiteI18n = { setLang, getLang, t, applyLang };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
