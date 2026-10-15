// Gemini translation: the page (with numbered boxes drawn on it) goes to Gemini,
// which reads each box and returns translations as structured JSON.

const API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
export const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
const DEFAULT_RPM = 15; // free tier, per model; corrected from 429 replies
const MAX_SIDE = 1536;
// Normal replies take 1-7 s; a request still pending after this is stuck on
// Google's side, and a fresh retry is much faster.
const ATTEMPT_TIMEOUT = 25000;
// A request with no reply after this long gets a parallel duplicate ("hedge").
const HEDGE_AFTER = 7000;
const MAX_ATTEMPTS = 6;
const LIMITS_KEY = "mt-rate-limits";
// Latency-based routing: each model's typical reply time (ms) is learned from real
// replies. Until then (and as old measurements age), these starting guesses apply.
const LATENCY_PRIOR = { "gemini-3.5-flash-lite": 3000, "gemini-3.1-flash-lite": 6000, "gemini-3.8-flash": 20000 };
const LATENCY_DEFAULT = 10000;
const LATENCY_DECAY = 10 * 60000; // measurements fade back to the guess over ~10 min
const LATENCY_KEY = "mt-latency";
const SLOW_SAMPLE = { timeout: ATTEMPT_TIMEOUT, overloaded: 15000 }; // how failures count
const SAFETY = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT"].map((category) => ({ category, threshold: "BLOCK_NONE" }));

const LANG_NAMES = {
  ja: "Japanese", zh: "Chinese", ko: "Korean", en: "English", es: "Spanish", fr: "French", de: "German",
  pt: "Portuguese", it: "Italian", ru: "Russian", vi: "Vietnamese", id: "Indonesian", th: "Thai",
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "INTEGER" },
          source: { type: "STRING" },
          translation: { type: "STRING" },
          kind: { type: "STRING", enum: ["dialogue", "thought", "narration", "sfx", "sign", "none"] },
        },
        required: ["id", "source", "translation", "kind"],
      },
    },
  },
  required: ["items"],
};

export class TranslatorError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ inputs
/** Split tall images into vertical chunks (aspect <= ~1:1.8) without cutting through boxes. */
function chunks(height, width, boxes) {
  const target = Math.trunc(width * 1.8);
  if (height <= target * 1.15) return [[0, height]];
  const spans = [];
  let y = 0;
  while (height - y > target * 1.15) {
    let cut = y + target;
    // Move the cut upward until it doesn't intersect a box.
    while (cut > y + Math.trunc(target / 2) && boxes.some((b) => b.y1 < cut && cut < b.y2)) cut -= 8;
    spans.push([y, cut]);
    y = cut;
  }
  spans.push([y, height]);
  return spans;
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Draw numbered boxes; return base64 JPEG chunks. */
export async function renderInputs(source, width, height, boxes) {
  const out = [];
  for (const [y0, y1] of chunks(height, width, boxes)) {
    const ids = boxes.map((b, i) => [b, i]).filter(([b]) => y0 <= (b.y1 + b.y2) / 2 && (b.y1 + b.y2) / 2 < y1);
    if (!ids.length) continue;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, y1 - y0));
    const cw = Math.round(width * scale), ch = Math.round((y1 - y0) * scale);
    const canvas = new OffscreenCanvas(cw, ch);
    const g = canvas.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(source, 0, y0, width, y1 - y0, 0, 0, cw, ch);
    const lw = Math.max(2, Math.round(cw / 400));
    const size = Math.max(14, Math.round(cw / 45));
    g.font = `bold ${size}px Arial, sans-serif`;
    g.textBaseline = "top";
    for (const [b, i] of ids) {
      const r = [(b.x1 - 4) * scale, (b.y1 - y0 - 4) * scale, (b.x2 + 4) * scale, (b.y2 - y0 + 4) * scale];
      g.strokeStyle = "#ff0000";
      g.lineWidth = lw;
      g.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      const label = String(i + 1);
      const tw = g.measureText(label).width + 6, th = size + 6;
      const lx = Math.max(0, r[0] - tw), ly = Math.max(0, r[1] - th);
      g.fillStyle = "#ff0000";
      g.fillRect(lx, ly, tw, th);
      g.fillStyle = "#ffffff";
      g.fillText(label, lx + 3, ly + 3);
    }
    out.push(await toBase64(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 })));
  }
  return out;
}

export function buildPrompt(n, src, tgt, context) {
  const srcName = src === "auto" ? "Japanese, Chinese or Korean (detect it)" : LANG_NAMES[src] || "the source language";
  const tgtName = LANG_NAMES[tgt] || tgt;
  const lines = [
    `This is a comic page (manga/manhwa/manhua). Red numbered boxes 1..${n} mark the text found on it: usually one box per speech balloon, caption or sign. The boxes and numbers are not part of the page.`,
    `For EVERY box id, read the text inside it (${srcName}) and translate it into natural ${tgtName}.`,
    "Rules:",
    "- Translate like a professional scanlation team: natural, concise phrasing that fits a speech bubble; keep tone, personality and emphasis.",
    "- Use the artwork and the reading order for context (who speaks, what is happening). Japanese manga reads right-to-left.",
    "- Keep honorifics out unless meaningful; romanize names consistently.",
    "- Vertical text is read top-to-bottom, columns right-to-left.",
    "- kind: dialogue / thought / narration / sfx (sound effect drawn into the art; it stays as drawn, so translation = \"\") / sign (in-world writing) / none (box has no real text, then translation = \"\").",
    "- 'source' is the exact original text you read (fix obvious OCR errors).",
    "- When one word or sentence is spread over several boxes (shouted a character or two per balloon, or a line continued in the next balloon), split the translation across those boxes in the order the page is read (this can differ from the box numbers), so that read in that order it says the whole line, e.g. \"LAUN-\" / \"DRY!!\".",
    "- Keep each translation about as long as the original line would be when spoken, since it has to fit the same balloon. No notes or explanations.",
  ];
  if (context.length) {
    lines.push("Previously translated lines from earlier pages (for name/term consistency):", ...context);
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ Gemini
export class GeminiTranslator {
  constructor() {
    this.recent = {}; // model -> sorted start times (ms) of requests in the last minute
    this.cooldown = {}; // model -> time when usable again
    this.noThinking = new Set();
    this.lock = Promise.resolve();
    try {
      this.rpm = JSON.parse(localStorage.getItem(LIMITS_KEY) || "{}");
    } catch {
      this.rpm = {};
    }
    try {
      this.latency = JSON.parse(localStorage.getItem(LATENCY_KEY) || "{}"); // model -> { ewma, at }
    } catch {
      this.latency = {};
    }
  }

  /** Expected reply time (ms): the learned average, fading back to the guess as it ages,
   *  so a model that had a slow spell gets tried again later. */
  expectedLatency(m) {
    const prior = LATENCY_PRIOR[m] ?? LATENCY_DEFAULT;
    const s = this.latency[m];
    if (!s) return prior;
    return prior + (s.ewma - prior) * Math.exp(-(Date.now() - s.at) / LATENCY_DECAY);
  }

  recordLatency(m, ms) {
    this.latency[m] = { ewma: this.expectedLatency(m) * 0.7 + ms * 0.3, at: Date.now() };
    try {
      localStorage.setItem(LATENCY_KEY, JSON.stringify(this.latency));
    } catch {}
  }

  /** Models from currently fastest to slowest (for the popup). */
  ranked() {
    return [...MODELS].sort((a, b) => this.expectedLatency(a) - this.expectedLatency(b));
  }

  readyAt(m) {
    const now = Date.now();
    const window = (this.recent[m] ||= []);
    while (window.length && window[0] <= now - 60000) window.shift();
    const limit = this.rpm[m] || DEFAULT_RPM;
    const freeAt = window.length < limit ? now : window[window.length - limit] + 60500;
    return Math.max(this.cooldown[m] || 0, freeAt);
  }

  /** The model expected to answer soonest: time until it has quota to spare plus its
   *  typical reply time. `avoid` (models already working on this page) only loses ties
   *  with a big handicap, so a parallel request goes to a different model when possible. */
  pickModel(avoid = new Set()) {
    const now = Date.now();
    let best = null, bestDone = Infinity;
    for (const m of MODELS) {
      const wait = Math.max(0, this.readyAt(m) - now);
      const done = wait + this.expectedLatency(m) + (avoid.has(m) ? 30000 : 0);
      if (done < bestDone) [best, bestDone] = [m, done];
    }
    return [best, Math.max(0, this.readyAt(best) - now)];
  }

  hasSpareQuota() {
    return MODELS.some((m) => this.readyAt(m) <= Date.now());
  }

  rateLimited(model, text) {
    const m = /"retryDelay":\s*"(\d+)/.exec(text);
    let delay = m ? Number(m[1]) + 1 : 30;
    if (text.includes("PerDay")) {
      delay = 3600; // daily quota used up: park this model for a long time
    } else {
      const q = /"quotaValue":\s*"(\d+)"/.exec(text);
      if (q && Number(q[1]) > 0) {
        this.rpm[model] = Number(q[1]);
        try {
          localStorage.setItem(LIMITS_KEY, JSON.stringify(this.rpm));
        } catch {}
      }
    }
    this.cooldown[model] = Date.now() + delay * 1000;
    console.warn(`[translator] ${model} rate-limited for ${delay}s`);
  }

  async translate({ apiKey, images, n, src, tgt, context }) {
    if (!apiKey) throw new TranslatorError("Add your Gemini API key in the extension popup");
    const parts = [{ text: buildPrompt(n, src, tgt, context) },
      ...images.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } }))];

    // Gemini's reply time is long-tailed: most replies take 1-7 s, but some take
    // 15-25 s or hang. If one is slow, a second identical request usually wins, so
    // after HEDGE_AFTER one runs in parallel; the first reply is used. Time spent
    // waiting for a rate-limit slot doesn't count: the clock starts when it's sent.
    const running = new Map(); // promise -> { sentAt, abort, model }
    let attempts = 0;
    let error = null;
    const launch = () => {
      const avoid = new Set([...running.values()].map((s) => s.model).filter(Boolean));
      const state = { sentAt: null, abort: new AbortController(), model: null };
      const p = this.attempt(apiKey, parts, n, ++attempts, state, avoid).then(
        (items) => ({ p, items }),
        (e) => ({ p, error: e }),
      );
      running.set(p, state);
    };
    launch();
    try {
      while (running.size) {
        const tick = sleep(500).then(() => null);
        const done = await Promise.race([...running.keys(), tick]);
        if (!done) {
          const now = Date.now();
          const allSlow = [...running.values()].every((s) => s.sentAt && now - s.sentAt > HEDGE_AFTER);
          if (running.size < 2 && attempts < MAX_ATTEMPTS && allSlow && this.hasSpareQuota()) {
            console.info(`[translator] no reply in ${HEDGE_AFTER / 1000}s: sending a parallel request`);
            launch();
          }
          continue;
        }
        running.delete(done.p);
        if (done.error) {
          if (!(done.error instanceof TranslatorError)) throw done.error;
          error = done.error; // not worth retrying (refused page, bad request...)
          continue;
        }
        if (done.items) return done.items;
        if (!running.size && attempts < MAX_ATTEMPTS) launch(); // retryable failure
      }
      throw error || new TranslatorError("Gemini: too many retries");
    } finally {
      for (const s of running.values()) s.abort.abort();
    }
  }

  /** One request. Returns the items, null if worth retrying, or throws TranslatorError. */
  async attempt(apiKey, parts, n, attempt, state, avoid) {
    let model, wait;
    await (this.lock = this.lock.then(() => { // pick + reserve a slot atomically
      [model, wait] = this.pickModel(avoid);
      state.model = model;
      if (wait <= 120000) {
        const w = (this.recent[model] ||= []);
        w.push(Date.now() + wait);
        w.sort((a, b) => a - b);
      }
    }));
    if (wait > 120000) throw new TranslatorError(`All Gemini models rate-limited; retry in ${Math.round(wait / 1000)}s`);
    if (wait > 0) await sleep(wait);
    if (state.abort.signal.aborted) return null;
    const generationConfig = { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.3 };
    if (!this.noThinking.has(model)) generationConfig.thinkingConfig = { thinkingLevel: "low" };
    const body = { contents: [{ role: "user", parts }], generationConfig, safetySettings: SAFETY };
    state.sentAt = Date.now();
    const timeout = setTimeout(() => state.abort.abort("timeout"), ATTEMPT_TIMEOUT);
    let r;
    try {
      r = await fetch(API.replace("{model}", model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: state.abort.signal,
      });
    } catch (e) {
      const elapsed = Date.now() - state.sentAt;
      if (state.abort.signal.reason === "timeout") {
        console.warn(`[translator] ${model}: no reply in ${ATTEMPT_TIMEOUT / 1000}s`);
        this.recordLatency(model, SLOW_SAMPLE.timeout);
        return null;
      }
      if (state.abort.signal.aborted) {
        // Lost the race to a parallel request: it was at least this slow.
        if (elapsed > this.expectedLatency(model)) this.recordLatency(model, elapsed);
        return null;
      }
      console.warn(`[translator] ${model}: ${e.message}`);
      await sleep(Math.min(2 ** attempt, 8) * 1000);
      return null;
    } finally {
      clearTimeout(timeout);
    }
    const text = await r.text();
    const elapsed = Date.now() - state.sentAt;
    console.info(`[translator] ${model} -> ${r.status} in ${(elapsed / 1000).toFixed(1)}s`);
    if (r.status === 200) {
      this.recordLatency(model, elapsed);
      return this.parse(JSON.parse(text), n);
    }
    if (r.status === 400 && /thinking/i.test(text) && !this.noThinking.has(model)) {
      this.noThinking.add(model);
      return null;
    }
    if (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(text)) {
      throw new TranslatorError("Your Gemini API key isn't valid. Check it in the extension popup.");
    }
    if (r.status === 429) {
      this.rateLimited(model, text);
      return null;
    }
    if ([500, 502, 503, 504].includes(r.status)) {
      this.recordLatency(model, Math.max(elapsed, SLOW_SAMPLE.overloaded));
      await sleep(Math.min(2 ** attempt, 8) * 1000);
      return null;
    }
    throw new TranslatorError(`Gemini error ${r.status}: ${text.slice(0, 300)}`);
  }

  parse(resp, n) {
    const block = resp.promptFeedback?.blockReason;
    if (block) throw new TranslatorError(`Gemini refused this page (${block})`);
    let data;
    try {
      const text = resp.candidates[0].content.parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
      data = JSON.parse(text);
    } catch {
      throw new TranslatorError(`Unexpected Gemini response: ${JSON.stringify(resp).slice(0, 300)}`);
    }
    return toItems(data, n);
  }
}

function toItems(data, n) {
  return (data.items || [])
    .map((it) => ({ id: Number(it.id) - 1, source: it.source || "", translation: it.translation || "", kind: it.kind || "dialogue" }))
    .filter((it) => it.id >= 0 && it.id < n);
}

// ------------------------------------------------------------------ OpenRouter
// With an OpenRouter key, every page goes to Claude Haiku 5.5 with low reasoning
// instead of Gemini. Same prompt and page images; one model, so no routing.
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_MODEL = "anthropic/claude-haiku-5.5";
export const OPENROUTER_LABEL = "Claude Haiku 5.5";
// Reasoning can make replies slower than Gemini Flash-Lite's; a request still pending
// after this is stuck, and a retry is faster.
const OPENROUTER_TIMEOUT = 90000;
const OPENROUTER_ATTEMPTS = 3;
const JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          source: { type: "string" },
          translation: { type: "string" },
          kind: { type: "string", enum: ["dialogue", "thought", "narration", "sfx", "sign", "none"] },
        },
        required: ["id", "source", "translation", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export class OpenRouterTranslator {
  async translate({ apiKey, images, n, src, tgt, context }) {
    const body = {
      model: OPENROUTER_MODEL,
      messages: [{
        role: "user",
        content: [{ type: "text", text: buildPrompt(n, src, tgt, context) },
          ...images.map((data) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data}` } }))],
      }],
      reasoning: { effort: "low", exclude: true }, // reasoning isn't shown, so don't send it back
      response_format: { type: "json_schema", json_schema: { name: "translations", strict: true, schema: JSON_SCHEMA } },
      max_tokens: 16000,
      provider: { require_parameters: true }, // only providers that honour the JSON schema
    };
    for (let attempt = 1; ; attempt++) {
      const items = await this.attempt(apiKey, body, n);
      if (items) return items;
      if (attempt >= OPENROUTER_ATTEMPTS) throw new TranslatorError("OpenRouter: too many retries");
      await sleep(Math.min(2 ** attempt, 8) * 1000);
    }
  }

  /** One request. Returns the items, null if worth retrying, or throws TranslatorError. */
  async attempt(apiKey, body, n) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), OPENROUTER_TIMEOUT);
    const t0 = Date.now();
    let r, text;
    try {
      r = await fetch(OPENROUTER_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "Manga Translator" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      text = await r.text();
    } catch (e) {
      console.warn(`[translator] OpenRouter: ${abort.signal.aborted ? `no reply in ${OPENROUTER_TIMEOUT / 1000}s` : e.message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
    console.info(`[translator] ${OPENROUTER_MODEL} -> ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (r.status === 401) throw new TranslatorError("Your OpenRouter API key isn't valid. Check it in the extension popup.");
    if (r.status === 402) throw new TranslatorError("Your OpenRouter account is out of credits");
    if (r.status === 429 || r.status === 408 || r.status >= 500) return null;
    if (r.status !== 200) throw new TranslatorError(`OpenRouter error ${r.status}: ${text.slice(0, 300)}`);
    let resp;
    try {
      resp = JSON.parse(text);
    } catch {
      return null; // cut-off reply
    }
    if (resp.error) { // an error from the model's provider, reported with status 200
      const code = Number(resp.error.code);
      if (code === 429 || code >= 500) return null;
      throw new TranslatorError(`OpenRouter error: ${String(resp.error.message || "").slice(0, 300)}`);
    }
    const choice = resp.choices?.[0];
    if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) {
      throw new TranslatorError("Claude refused this page");
    }
    if (choice?.finish_reason === "length") return null;
    try {
      // Some providers wrap the JSON in a code fence despite the schema.
      const content = String(choice.message.content || "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
      return toItems(JSON.parse(content), n);
    } catch {
      throw new TranslatorError(`Unexpected OpenRouter response: ${text.slice(0, 300)}`);
    }
  }
}
