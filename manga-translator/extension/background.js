// Service worker: routes translation requests to the engine (a hidden offscreen page
// that runs text detection and calls Gemini), sets up hotlink workarounds, and
// captures screenshots for canvas readers.
import { getSettings, getTranslator } from "./settings.js";

// The engine spreads requests over Gemini models and their per-minute quotas.
const MAX_CONCURRENT = 8;
let active = 0;
const waiting = [];

async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ---- Referer spoofing for image hosts with hotlink protection -------------
// Requests from the engine page have no tab (tabId -1). A session rule sets
// the Referer to the page the image came from, only for those requests.
const refererRules = new Map(); // host -> referer

function ruleId(host) {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 1_000_000) + 1;
}

async function ensureReferer(imageUrl, pageUrl) {
  const host = new URL(imageUrl).hostname;
  const referer = new URL(pageUrl).origin + "/";
  if (refererRules.get(host) === referer) return;
  const id = ruleId(host);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "referer", operation: "set", value: referer }],
      },
      condition: { requestDomains: [host], tabIds: [-1], resourceTypes: ["xmlhttprequest", "other"] },
    }],
  });
  refererRules.set(host, referer);
}

// ---- Screenshot capture (canvas readers, protected images) ----------------
// captureVisibleTab is limited to ~2 calls/second, so captures are serialized.
let captureChain = Promise.resolve();
let lastCapture = 0;

function captureRegion(windowId, rect, dpr) {
  const job = captureChain.then(async () => {
    const wait = lastCapture + 600 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCapture = Date.now();
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.min(bmp.width - sx, Math.round(rect.width * dpr));
    const sh = Math.min(bmp.height - sy, Math.round(rect.height * dpr));
    const canvas = new OffscreenCanvas(sw, sh);
    canvas.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.convertToBlob({ type: "image/png" });
  });
  captureChain = job.catch(() => {});
  return job;
}

// ---- Engine (offscreen page) --------------------------------------------------
const ENGINE_URL = "engine/offscreen.html";
let creating = null;

async function ensureEngine() {
  const open = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (open.length) return;
  creating ||= chrome.offscreen.createDocument({
    url: ENGINE_URL,
    reasons: ["WORKERS"],
    justification: "Runs text detection (WebGPU/WebAssembly) and translation requests.",
  }).finally(() => (creating = null));
  await creating;
}

async function engine(request) {
  await ensureEngine();
  let resp;
  // Right after the engine page is created it may not be listening yet: retry briefly.
  for (let i = 0; ; i++) {
    try {
      resp = await chrome.runtime.sendMessage({ target: "engine", ...request });
      break;
    } catch (e) {
      if (i >= 40 || !/Receiving end does not exist/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!resp) throw new Error("Translation engine didn't answer");
  if (!resp.ok) throw new Error(resp.error);
  return resp.result;
}

async function translate(image, ctx) {
  const s = await getSettings();
  const { provider, apiKey } = await getTranslator();
  return engine({ type: "translate", ...image, src: s.srcLang, tgt: s.tgtLang, ctx: ctx || "default", apiKey, provider, scale: s.textScale });
}

async function health() {
  const { provider, apiKey } = await getTranslator();
  try {
    const st = await engine({ type: "status", provider });
    return { ok: !st.error, error: st.error, translator: provider, has_key: !!apiKey, models: st.models, detector_device: st.device };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "engine") return false; // for the engine page
  const handle = async () => {
    switch (msg.type) {
      case "translate-url":
        await ensureReferer(msg.src, msg.pageUrl);
        return withSlot(() => translate({ url: msg.src }, msg.ctx));
      case "translate-data":
        return withSlot(() => translate({ dataUrl: msg.dataUrl }, msg.ctx));
      case "capture":
        return blobToDataUrl(await captureRegion(sender.tab.windowId, msg.rect, msg.dpr));
      case "health":
        return health();
      case "warmup": // a page with auto-translate opened: load the model now
        return ensureEngine();
      case "toggle-overlay":
        return toggleOverlay();
    }
  };
  handle().then(
    (result) => sendResponse({ ok: true, result }),
    (e) => sendResponse({ ok: false, error: String(e.message || e) }),
  );
  return true; // async response
});

// ---- Injection into open tabs ------------------------------------------------
// Chrome only injects content scripts into pages loaded after install. On install
// or update, inject into open tabs too; a fresh copy replaces any stale one.
async function injectInto(tabId) {
  const target = { tabId, allFrames: true };
  await chrome.scripting.insertCSS({ target, files: ["overlay.css"] });
  await chrome.scripting.executeScript({ target, files: ["content.js"] });
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(tabs.map((t) => injectInto(t.id).catch(() => {}))); // e.g. store pages
}

// ---- Context menu & keyboard shortcut ---------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "mt-image", title: "Translate this image", contexts: ["image"] });
    chrome.contextMenus.create({ id: "mt-page", title: "Translate images on this page", contexts: ["page"] });
  });
  injectIntoOpenTabs();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "mt-image") {
    chrome.tabs.sendMessage(tab.id, { type: "translate-image", srcUrl: info.srcUrl }, { frameId: info.frameId });
  } else if (info.menuItemId === "mt-page") {
    chrome.tabs.sendMessage(tab.id, { type: "start" });
  }
});

// The browser shortcut and the page's own key listener can both fire for one press:
// count it once.
let lastToggle = 0;
async function toggleOverlay() {
  if (Date.now() - lastToggle < 400) return;
  lastToggle = Date.now();
  const s = await getSettings();
  await chrome.storage.sync.set({ showOverlay: !s.showOverlay });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-overlay") toggleOverlay();
});
