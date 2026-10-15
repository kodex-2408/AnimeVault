// Image -> text detection -> units (one per balloon) -> translation -> lettered
// page, with caching. The same pipeline as Tsundoku's built-in reader:
//   detector.js  finds the letters (comic-text-detector: blocks + stroke map);
//   typeset.js   (shared with Tsundoku, loaded by offscreen.html as global TS)
//                splits the blocks into one unit per balloon, and after the
//                translation erases the original text and letters the
//                translation into each balloon's shape;
//   translator.js reads and translates the numbered units (Gemini / OpenRouter).
// The result is the lettered page as a transparent PNG holding only the pixels
// that changed; the page draws it over the image.
import { TextDetector, modelProgress } from "./detector.js";
import { GeminiTranslator, OpenRouterTranslator, OPENROUTER_LABEL, TranslatorError, renderInputs } from "./translator.js";

// Bump when detection/layout/translation output changes, to invalidate cached results.
const PIPELINE_VERSION = "9";
const TS = globalThis.TS;
// The lettering font, for the canvas (the page's own CSS can't reach this document).
const FONT_READY = (async () => {
  const f = new FontFace("Comic Neue", `url(${new URL("../fonts/ComicNeue-Bold.ttf", import.meta.url).href})`, { weight: "700" });
  document.fonts.add(await f.load());
})().catch((e) => console.warn("[typeset] font:", e));
const MAX_CONTEXTS = 100;
const CONTEXT_LINES = 16;
const DETECTIONS_KEPT = 12;
const KEEP_MARGIN = 4; // px of original kept opaque around every change (see run)

// ------------------------------------------------------------------ cache (IndexedDB)
// Best effort: if the browser can't open the database, pages are still translated,
// just not cached.
const db = new Promise((resolve) => {
  try {
    const req = indexedDB.open("manga-translator", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("results");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn("[cache] unavailable:", req.error);
      resolve(null);
    };
  } catch (e) {
    console.warn("[cache] unavailable:", e);
    resolve(null);
  }
});

async function cacheGet(key) {
  const d = await db;
  if (!d) return undefined;
  return new Promise((resolve) => {
    const r = d.transaction("results").objectStore("results").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });
}

async function cachePut(key, value) {
  const d = await db;
  if (!d) return;
  return new Promise((resolve) => {
    const tx = d.transaction("results", "readwrite");
    tx.objectStore("results").put(value, key);
    tx.oncomplete = tx.onerror = () => resolve();
  });
}

async function sha256(bytes, suffix) {
  const extra = new TextEncoder().encode(suffix);
  const all = new Uint8Array(bytes.byteLength + extra.length);
  all.set(new Uint8Array(bytes), 0);
  all.set(extra, bytes.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Grow a 0/1 mask by r pixels (square), in place: rows, then columns.
function dilate(m, w, h, r) {
  const tmp = new Uint8Array(Math.max(w, h));
  const pass = (n, len, at) => {
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < len; i++) tmp[i] = m[at(k, i)];
      let last = -Infinity; // nearest set index at or before i
      for (let i = 0; i < len; i++) {
        if (tmp[i]) last = i;
        let on = i - last <= r;
        for (let j = i + 1; !on && j <= i + r && j < len; j++) on = tmp[j] === 1;
        m[at(k, i)] = on ? 1 : 0;
      }
    }
  };
  pass(h, w, (y, x) => y * w + x);
  pass(w, h, (x, y) => y * w + x);
}

// ------------------------------------------------------------------ engine
export class Engine {
  constructor() {
    this.detector = null;
    this.startDetector();
    this.translator = new GeminiTranslator();
    this.openrouter = new OpenRouterTranslator();
    this.inflight = new Map();
    this.context = new Map(); // reading context (series/chapter) -> recent lines, for consistency
    this.detections = new Map(); // recent pages' detections, so a new text size only re-letters
  }

  // A failed start (no connection for the model download, say) is retried on
  // the next page instead of needing an extension reload.
  startDetector() {
    this.startError = null;
    this.detectorReady = TextDetector.create().then((d) => (this.detector = d));
    this.detectorReady.catch((e) => { this.startError = e; this.failedAt = Date.now(); });
  }

  status(provider) {
    // Opening the panel a while after a failure tries again.
    if (this.startError && Date.now() - (this.failedAt || 0) > 15000) this.startDetector();
    return {
      device: this.detector?.device || (this.startError ? "failed" : "loading"),
      download: modelProgress,
      error: this.startError ? String(this.startError.message || this.startError) : null,
      models: provider === "openrouter" ? [OPENROUTER_LABEL] : this.translator.ranked(), // fastest first
    };
  }

  /** bytes: ArrayBuffer of an image. Returns { width, height, image (PNG data URL of
   *  the changed pixels, or null), blocks (what was read and translated), timings }.
   *  Translations are cached apart from the lettered image, so a new text size
   *  re-letters the page without asking the translation service again. */
  async process({ bytes, src, tgt, ctx, apiKey, provider = "gemini", scale = 1 }) {
    // Each translation service has its own cached results.
    const key = await sha256(bytes, `|${src}|${tgt}|${PIPELINE_VERSION}${provider === "gemini" ? "" : `|${provider}`}`);
    const imgKey = `${key}|img|${Math.round(scale * 100)}`;
    const cached = await cacheGet(imgKey);
    if (cached) return { ...cached, cached: true };
    if (this.inflight.has(imgKey)) return this.inflight.get(imgKey);
    const job = this.run(bytes, key, src, tgt, ctx, apiKey, provider, scale).then(async (result) => {
      await cachePut(imgKey, result);
      return result;
    });
    this.inflight.set(imgKey, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(imgKey);
    }
  }

  async run(bytes, key, src, tgt, ctx, apiKey, provider, scale) {
    const t0 = performance.now();
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes]));
    } catch (e) {
      throw new TranslatorError(`Cannot decode image: ${e.message}`);
    }
    const { width: w, height: h } = bitmap;
    try {
      if (this.startError) this.startDetector();
      await this.detectorReady;
      let det = this.detections.get(key);
      if (!det) {
        det = await this.detector.detect(bitmap, w, h);
        this.detections.set(key, det);
        if (this.detections.size > DETECTIONS_KEPT) this.detections.delete(this.detections.keys().next().value);
      }
      const st = det.stats;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0);
      const img = g.getImageData(0, 0, w, h);
      // One unit per balloon (or per lobe of joined balloons), in reading order.
      const plan = TS.plan(img, { boxes: det.boxes, strokes: det.strokes });
      const result = {
        width: w, height: h, image: null, blocks: [],
        timings: {
          detect: +((performance.now() - t0) / 1000).toFixed(2), device: this.detector.device, tiles: st.tiles,
          pre_ms: Math.round(st.pre), infer_ms: Math.round(st.infer), post_ms: Math.round(st.post),
        },
      };
      if (!plan.units.length) return result;

      let items = await cacheGet(key);
      if (!items) {
        if (!this.context.has(ctx) && this.context.size >= MAX_CONTEXTS) {
          this.context.delete(this.context.keys().next().value); // drop the oldest reading context
        }
        const hist = this.context.get(ctx) || [];
        this.context.set(ctx, hist);
        const t1 = performance.now();
        const boxes = plan.units.map((u) => ({ x1: u.tb.x1, y1: u.tb.y1, x2: u.tb.x2 + 1, y2: u.tb.y2 + 1 }));
        const images = await renderInputs(bitmap, w, h, boxes);
        const translator = provider === "openrouter" ? this.openrouter : this.translator;
        items = await translator.translate({ apiKey, images, n: boxes.length, src, tgt, context: [...hist] });
        result.timings.translate = +((performance.now() - t1) / 1000).toFixed(2);
        await cachePut(key, items);
        for (const it of items) {
          if (["dialogue", "thought", "narration"].includes(it.kind) && it.source && it.translation.trim()) {
            hist.push(`${it.source} => ${it.translation.trim()}`);
            if (hist.length > CONTEXT_LINES) hist.shift();
          }
        }
      }
      // Sound effects stay as drawn; boxes without real text are left alone.
      const lettered = items
        .filter((it) => it.kind !== "none" && it.kind !== "sfx" && it.translation.trim() && plan.units[it.id])
        .map((it) => ({ region: plan.units[it.id].id, text: it.translation.trim() }));
      result.blocks = items.map((it) => ({ source: it.source, translation: it.translation.trim(), kind: it.kind }));
      if (!lettered.length) return result;

      await FONT_READY;
      const before = new Uint8ClampedArray(img.data);
      TS.render(g, img, plan, lettered, { scale });
      // Keep only what changed, plus a margin: the page shows the original everywhere
      // else. When the browser shows the page smaller than its pixels, it blends each
      // screen pixel from several image pixels, so the original letters' ink reaches a
      // few pixels past them; the margin (original pixels, opaque) covers that.
      const after = g.getImageData(0, 0, w, h), d = after.data;
      const keep = new Uint8Array(w * h);
      for (let i = 0, p = 0; p < keep.length; i += 4, p++) {
        keep[p] = d[i] !== before[i] || d[i + 1] !== before[i + 1] || d[i + 2] !== before[i + 2] ? 1 : 0;
      }
      dilate(keep, w, h, KEEP_MARGIN);
      for (let p = 0; p < keep.length; p++) if (!keep[p]) d[p * 4 + 3] = 0;
      g.putImageData(after, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      result.image = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      result.timings.total = +((performance.now() - t0) / 1000).toFixed(2);
      return result;
    } finally {
      bitmap.close();
    }
  }
}
