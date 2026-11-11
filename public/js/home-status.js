/**
 * Homepage Mock / DeepSeek copy follows GET /api/health.
 * The key never leaves the server. A missing key keeps the Mock strings.
 */
(function () {
  const sub = document.getElementById('homeSubtitle');
  const foot = document.getElementById('homeFooter');
  if (!sub || !foot) return;

  let live = false;

  function applyMode() {
    sub.setAttribute('data-i18n', live ? 'home.subtitle.live' : 'home.subtitle');
    foot.setAttribute('data-i18n', live ? 'home.footer.live' : 'home.footer');
    if (window.I18N) I18N.apply(document);
  }

  if (window.I18N && typeof I18N.onChange === 'function') I18N.onChange(applyMode);

  fetch('/api/health')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      live = !!(data && data.mode === 'live' && data.adapter && data.adapter.provider === 'deepseek');
      applyMode();
    })
    .catch(() => {});
})();
