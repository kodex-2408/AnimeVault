// Shared settings (chrome.storage.sync). Imported by background.js and popup.js;
// content.js keeps its own copy of DEFAULTS because content scripts can't use ES modules.
// The API keys (Gemini, OpenRouter) are kept separately in chrome.storage.local, so they never sync.
export const DEFAULTS = {
  srcLang: "auto",
  tgtLang: "en",
  enabledSites: {}, // { "host": true }
  minSize: 300, // minimum natural width/height (px) for an image to be translated
  textScale: 1, // translated text size (1 = default)
  showOverlay: true,
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

export function setSettings(patch) {
  return chrome.storage.sync.set(patch);
}

export async function getApiKey() {
  return (await chrome.storage.local.get("geminiKey")).geminiKey || "";
}

export function setApiKey(key) {
  return chrome.storage.local.set({ geminiKey: key.trim() });
}

/** With an OpenRouter key, translations use Claude Haiku 5.5 instead of Gemini. */
export async function getOpenRouterKey() {
  return (await chrome.storage.local.get("openrouterKey")).openrouterKey || "";
}

export function setOpenRouterKey(key) {
  return chrome.storage.local.set({ openrouterKey: key.trim() });
}

/** "Use GPT-6 Luna (medium)": with an OpenRouter key, Luna translates instead of Haiku. */
export async function getUseLuna() {
  return !!(await chrome.storage.local.get("useLuna")).useLuna;
}

export function setUseLuna(on) {
  return chrome.storage.local.set({ useLuna: !!on });
}

/** Which service translates, and with which key. Each one caches its own results. */
export async function getTranslator() {
  const { geminiKey, openrouterKey, useLuna } = await chrome.storage.local.get(["geminiKey", "openrouterKey", "useLuna"]);
  if (openrouterKey) return { provider: useLuna ? "openrouter-luna" : "openrouter", apiKey: openrouterKey };
  return { provider: "gemini", apiKey: geminiKey || "" };
}
