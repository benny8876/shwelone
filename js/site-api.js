
(function () {
  const ADMIN_PORT = '8790';

  function getApiBase() {
    if (location.protocol === 'file:') {
      return `http://localhost:${ADMIN_PORT}`;
    }
    const port = location.port;
    if (port === ADMIN_PORT || port === '') {
      return '';
    }
    return `${location.protocol}//${location.hostname}:${ADMIN_PORT}`;
  }

  function apiUrl(path) {
    const base = getApiBase();
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }

  window.SiteApi = { getApiBase, apiUrl };
})();
