
(function () {
  const DATA_URL = 'data/insights.json';

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  function insightUrl(slug) {
    const base = document.body.dataset.insightsBase || '';
    return `${base}insight.html?slug=${encodeURIComponent(slug)}`;
  }

  function cardImage(item) {
    if (item.imagePortrait) return item.image;
    return item.imageThumb || item.image;
  }

  function renderCard(item) {
    if (!item.published) return '';
    const thumb = cardImage(item);
    const portrait = !!item.imagePortrait;
    return `
      <a class="insight-card insight-card--visual reveal${portrait ? ' is-portrait' : ''}" href="${insightUrl(item.slug || item.id)}" aria-label="${esc(item.title)}">
        <div class="insight-card-media">
          <img src="${esc(thumb)}" alt="${esc(item.title)}" loading="lazy" />
        </div>
      </a>`;
  }

  function renderGrid(container, items, limit) {
    const published = items.filter((i) => i.published).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const list = limit ? published.slice(0, limit) : published;
    container.innerHTML = list.map(renderCard).join('');
    container.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
  }

  async function loadGrid(selector, limit) {
    const container = document.querySelector(selector);
    if (!container) return;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load insights');
      const data = await res.json();
      renderGrid(container, data.insights || [], limit);
    } catch (err) {
      console.warn('Insights loader:', err.message);
    }
  }

  async function loadArticle() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('slug');
    if (!slug) return;

    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const item = (data.insights || []).find((i) => i.slug === slug || i.id === slug);
      if (!item || !item.published) {
        document.querySelector('.article-wrap')?.insertAdjacentHTML('afterbegin', '<p>Article not found.</p>');
        return;
      }

      document.title = `${item.title} — Insights`;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.content = item.excerpt || '';

      const heroWrap = document.querySelector('.article-hero');
      const hero = document.querySelector('.article-hero img');
      if (hero) {
        hero.src = item.image;
        hero.alt = item.imageAlt || item.title;
      }
      if (heroWrap) {
        heroWrap.classList.toggle('is-portrait', !!item.imagePortrait);
      }

      const metaEl = document.querySelector('.article-meta');
      if (metaEl) metaEl.textContent = `${item.category} · ${formatDate(item.date)}`;

      const h1 = document.querySelector('.article-wrap h1');
      if (h1) h1.textContent = item.title;

      const lead = document.querySelector('.article-lead');
      if (lead) lead.textContent = item.lead || '';

      const body = document.querySelector('.article-body');
      if (body) body.innerHTML = item.body || '';
    } catch (err) {
      console.warn('Insight article:', err.message);
    }
  }

  window.ShweLoneInsights = { loadGrid, loadArticle };

  document.addEventListener('DOMContentLoaded', () => {
    const home = document.getElementById('home-insights-grid');
    if (home) {
      const limit = Number(home.dataset.insightsLimit) || 0;
      loadGrid('#home-insights-grid', limit || undefined);
    }
    if (document.getElementById('insights-page-grid')) {
      loadGrid('#insights-page-grid');
    }
    if (document.querySelector('.article-page')) {
      loadArticle();
    }
  });
})();
