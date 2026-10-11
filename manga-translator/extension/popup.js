import { getApiKey, getOpenRouterKey, getSettings, setApiKey, setOpenRouterKey, setSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try {
    host = new URL(tab.url).host;
  } catch {}
  const s = await getSettings();

  $("host").textContent = host || "this site";
  $("site-enabled").checked = !!s.enabledSites[host];
  $("site-enabled").disabled = !host;
  $("show-overlay").checked = s.showOverlay;
  $("src-lang").value = s.srcLang;
  $("tgt-lang").value = s.tgtLang;
  $("gemini-key").value = await getApiKey();
  $("openrouter-key").value = await getOpenRouterKey();
  $("min-size").value = s.minSize;

  $("site-enabled").addEventListener("change", async (e) => {
    const sites = { ...(await getSettings()).enabledSites };
    if (e.target.checked) sites[host] = true;
    else delete sites[host];
    setSettings({ enabledSites: sites });
  });
  $("translate-now").addEventListener("click", async () => {
    await sendToTab(tab.id, { type: "start" });
    window.close();
  });
  $("retry-failed").addEventListener("click", async () => {
    await sendToTab(tab.id, { type: "retry-failed" });
    window.close();
  });
  $("show-overlay").addEventListener("change", (e) => setSettings({ showOverlay: e.target.checked }));
  $("src-lang").addEventListener("change", (e) => setSettings({ srcLang: e.target.value }));
  $("tgt-lang").addEventListener("change", (e) => setSettings({ tgtLang: e.target.value }));
  $("gemini-key").addEventListener("change", async (e) => {
    await setApiKey(e.target.value);
    checkHealth();
  });
  $("openrouter-key").addEventListener("change", async (e) => {
    await setOpenRouterKey(e.target.value);
    checkHealth();
  });
  $("min-size").addEventListener("change", (e) => setSettings({ minSize: Number(e.target.value) || 300 }));

  // Text size: applied to open pages while dragging. Saves are debounced because
  // chrome.storage.sync allows only ~120 writes a minute.
  const showScale = (pct) => ($("text-scale-value").textContent = `${pct}%`);
  $("text-scale").value = Math.round(s.textScale * 100);
  showScale($("text-scale").value);
  let scaleTimer = null;
  $("text-scale").addEventListener("input", (e) => {
    showScale(e.target.value);
    clearTimeout(scaleTimer);
    scaleTimer = setTimeout(() => setSettings({ textScale: Number(e.target.value) / 100 }), 120);
  });

  checkHealth();
}

// The tab may have no content script yet (opened before install, or a stale copy
// after an update): inject a fresh one and try again.
async function sendToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    try {
      const target = { tabId, allFrames: true };
      await chrome.scripting.insertCSS({ target, files: ["overlay.css"] });
      await chrome.scripting.executeScript({ target, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, msg);
    } catch {} // e.g. chrome:// pages, where extensions can't run
  }
}

async function checkHealth() {
  const el = $("status");
  const resp = await chrome.runtime.sendMessage({ type: "health" });
  const h = resp?.result;
  el.className = "status";
  const text = $("status-text");
  if (!h?.ok) {
    el.classList.add("err");
    text.textContent = `Engine error: ${h?.error || resp?.error || "not responding"}`;
  } else if (!h.has_key) {
    el.classList.add("warn");
    text.textContent = "Add your free Gemini key below";
    // Show where: open the Advanced section and focus the key field.
    const field = $("gemini-key");
    field.closest("details")?.setAttribute("open", "");
    field.focus();
  } else if (h.detector_device === "loading") {
    text.textContent = "Starting…";
    setTimeout(checkHealth, 700);
  } else {
    el.classList.add("ok");
    text.textContent = `Ready · ${h.models[0]} · detector on ${h.detector_device}`;
  }
}

main();
