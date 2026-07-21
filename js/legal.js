
(function () {
  const tabs = document.querySelectorAll('.lang-tab');
  const panels = document.querySelectorAll('.legal-body[data-panel]');
  if (!tabs.length || !panels.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const lang = tab.getAttribute('data-lang');
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        const show = panel.getAttribute('data-panel') === lang;
        if (show) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });
    });
  });
})();
