/* Applies the cached theme before first paint so the window never flashes the wrong colors. */
(function () {
  try {
    var c = JSON.parse(localStorage.getItem('av_theme_cache') || 'null');
    if (!c || typeof c !== 'object') return;
    var r = document.documentElement;
    if (c.light) r.classList.add('light');
    if (/^#[0-9a-f]{6}$/i.test(c.accent || '')) r.style.setProperty('--accent', c.accent);
    if (/^[0-9, ]+$/.test(c.rgb || '')) r.style.setProperty('--accent-rgb', c.rgb);
    if (/^#[0-9a-f]{6}$/i.test(c.bg || '')) { r.style.setProperty('--bg', c.bg); r.style.background = c.bg; }
  } catch (e) { /* first run or storage unavailable */ }
})();
