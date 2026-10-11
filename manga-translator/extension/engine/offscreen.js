// Entry point of the hidden engine page. Offscreen pages can only use chrome.runtime,
// so background.js passes everything else (settings, API key) with each request.
//
// The listener is registered first, synchronously: the engine's modules (ONNX Runtime,
// the model) take a moment to load, and requests sent meanwhile must wait for them
// rather than fail with "Receiving end does not exist".
const engine = import("./pipeline.js").then(({ Engine }) => new Engine());

async function fetchImage(url) {
  // The background worker has set a Referer rule for this image host (hotlink protection).
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`Image fetch failed: HTTP ${r.status}`);
  const blob = await r.blob();
  if (!blob.type.startsWith("image/") && blob.size < 1000) throw new Error("Not an image");
  return blob.arrayBuffer();
}

async function handle(msg) {
  switch (msg.type) {
    case "status":
      return (await engine).status(msg.provider);
    case "translate": {
      const bytes = msg.url ? await fetchImage(msg.url) : await (await fetch(msg.dataUrl)).arrayBuffer();
      return (await engine).process({ bytes, src: msg.src, tgt: msg.tgt, ctx: msg.ctx, apiKey: msg.apiKey, provider: msg.provider, scale: msg.scale });
    }
    default:
      throw new Error(`Unknown engine request: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.target !== "engine") return false; // for background.js
  handle(msg).then(
    (result) => respond({ ok: true, result }),
    (e) => respond({ ok: false, error: String(e.message || e) }),
  );
  return true;
});
