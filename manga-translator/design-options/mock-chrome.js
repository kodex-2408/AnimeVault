// Preview only: fake extension APIs so the popup designs run as normal web pages.
// ?server=ok | nokey | down picks the engine status (the name is kept for old links).
// apply-design.bat removes this file's <script> tag when a design is copied into the extension.
(() => {
  if (window.chrome?.storage?.sync) return; // inside the real extension
  const state = new URLSearchParams(location.search).get('server') || 'ok';
  const sync = { enabledSites: { 'raw.senmanga.com': true }, textScale: 1 };
  const local = state === 'nokey' ? {} : { geminiKey: 'test-key' };
  const health = {
    ok: { ok: true, translator: 'gemini', models: ['gemini-3.5-flash-lite'], has_key: true, detector_device: 'GPU' },
    nokey: { ok: true, translator: 'gemini', models: ['gemini-3.5-flash-lite'], has_key: false, detector_device: 'GPU' },
    down: { ok: false, error: 'Text detector could not start' },
  }[state];
  window.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...sync }),
        set: async (items) => void Object.assign(sync, items),
      },
      local: {
        get: async (key) => (key in local ? { [key]: local[key] } : {}),
        set: async (items) => void Object.assign(local, items),
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://raw.senmanga.com/jujutsu-kaisen/271' }],
      sendMessage: async () => true,
    },
    scripting: { insertCSS: async () => {}, executeScript: async () => {} },
    runtime: { sendMessage: async () => ({ ok: true, result: health }) },
  };
})();
