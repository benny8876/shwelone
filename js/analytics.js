
(function () {
  if (location.pathname.startsWith('/admin')) return;

  const DEDUPE_MS = 30000;
  const key = 'sl_pv_' + location.pathname + location.search;
  try {
    const last = sessionStorage.getItem(key);
    if (last && Date.now() - Number(last) < DEDUPE_MS) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
 
  }

  const payload = {
    path: location.pathname + location.search,
    referrer: document.referrer || 'direct',
    screen: window.screen ? `${window.screen.width}x${window.screen.height}` : '',
  };

  const url = window.SiteApi
    ? SiteApi.apiUrl('/api/analytics/pageview')
    : '/api/analytics/pageview';

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
 
  }

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(function () {});
})();
