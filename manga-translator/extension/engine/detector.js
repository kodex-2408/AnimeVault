// Text block detection with comic-text-detector (ONNX), run by ONNX Runtime Web
// on the GPU (WebGPU) or, failing that, the CPU (WebAssembly).
//
// Outputs used (as in Tsundoku's renderer/textdetect.js):
//   blk - one box per text block (roughly one per speech bubble / caption);
//   det - the text-line map: drops empty blocks, adds blocks the head missed;
//   seg - per-pixel letter strokes, used by typeset.js to tell letters from art.
import * as ort from "./lib/ort/ort.webgpu.min.mjs";

const INPUT = 1024;
// The half-precision model (faster on the GPU), or else the model as published by
// manga-image-translator (full precision; the same file Tsundoku downloads).
const MODEL_FILES = ["comictextdetector-fp16.onnx", "comictextdetector.pt.onnx"];

async function loadModel() {
  for (const f of MODEL_FILES) {
    try {
      const r = await fetch(new URL(`./models/${f}`, import.meta.url));
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch {} // not there: try the next
  }
  throw new Error(`Text detection model missing: put ${MODEL_FILES.join(" or ")} in extension/engine/models (see the README there)`);
}
export const DETECT_CONF = 0.3;

ort.env.wasm.wasmPaths = new URL("./lib/ort/", import.meta.url).href;
// The engine runs in a hidden page, which otherwise gets the GPU's power-saving mode
// (measured: about 2x slower).
ort.env.webgpu.powerPreference = "high-performance";
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;

export class TextDetector {
  static async create() {
    const d = new TextDetector();
    const model = await loadModel();
    for (const ep of navigator.gpu ? ["webgpu", "wasm"] : ["wasm"]) {
      try {
        d.session = await ort.InferenceSession.create(model, { executionProviders: [ep] });
        d.device = ep === "webgpu" ? "GPU" : "CPU";
        break;
      } catch (e) {
        console.warn(`[detector] ${ep} unavailable:`, e);
      }
    }
    if (!d.session) throw new Error("Text detector could not start");
    d.canvas = new OffscreenCanvas(INPUT, INPUT);
    d.ctx = d.canvas.getContext("2d", { willReadFrequently: true });
    // Warm up: the first run compiles the GPU shaders (about 0.5 s). Do it now rather
    // than on the first page. Later runs queue behind it (one inference at a time).
    const blank = new ort.Tensor("float32", new Float32Array(3 * INPUT * INPUT), [1, 3, INPUT, INPUT]);
    d.queue = d.session.run({ [d.session.inputNames[0]]: blank }, ["blk", "seg", "det"]).catch(() => {});
    return d;
  }

  /** Runs the model on one tile (sx, sy, sw, sh of `source`). Boxes in source pixels. */
  async runTile(source, sx, sy, sw, sh, confThresh, stats) {
    const tStart = performance.now();
    const scale = INPUT / Math.max(sw, sh);
    const nw = Math.round(sw * scale);
    const nh = Math.round(sh * scale);
    const g = this.ctx;
    g.fillStyle = "#000";
    g.fillRect(0, 0, INPUT, INPUT);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(source, sx, sy, sw, sh, 0, 0, nw, nh);
    const px = g.getImageData(0, 0, INPUT, INPUT).data;
    const plane = INPUT * INPUT;
    const blob = new Float32Array(3 * plane);
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      blob[i] = px[p] / 255;
      blob[i + plane] = px[p + 1] / 255;
      blob[i + 2 * plane] = px[p + 2] / 255;
    }
    const input = new ort.Tensor("float32", blob, [1, 3, INPUT, INPUT]);
    const tPre = performance.now();
    const run = this.queue.then(async () => {
      const t = performance.now();
      const r = await this.session.run({ [this.session.inputNames[0]]: input }, ["blk", "seg", "det"]);
      stats.infer += performance.now() - t;
      return r;
    });
    this.queue = run.catch(() => {});
    const out = await run;
    const tPost = performance.now();
    const pred = out.blk.data;
    const [, n, dim] = out.blk.dims;
    const det = out.det.data; // [1, 2, 1024, 1024]; channel 0 is the text-line probability
    const seg = out.seg.data; // [1, 1, 1024, 1024]; letter strokes

    // Text-line mask (nh x nw) and its integral image, for fast area sums.
    const lines = new Uint8Array(nw * nh);
    const strokes = new Uint8Array(nw * nh); // 0-255: how surely a pixel is part of a letter
    const sum = new Int32Array((nw + 1) * (nh + 1));
    for (let y = 0; y < nh; y++) {
      let row = 0;
      for (let x = 0; x < nw; x++) {
        const on = det[y * INPUT + x] > 0.3 ? 1 : 0;
        lines[y * nw + x] = on;
        strokes[y * nw + x] = Math.round(Math.max(0, Math.min(1, seg[y * INPUT + x])) * 255);
        row += on;
        sum[(y + 1) * (nw + 1) + x + 1] = sum[y * (nw + 1) + x + 1] + row;
      }
    }
    const area = (x1, y1, x2, y2) => { // sum of lines[y1:y2, x1:x2], clipped like numpy slicing
      x1 = Math.max(0, Math.min(nw, x1)); x2 = Math.max(0, Math.min(nw, x2));
      y1 = Math.max(0, Math.min(nh, y1)); y2 = Math.max(0, Math.min(nh, y2));
      if (x2 <= x1 || y2 <= y1) return [0, 0];
      const s = sum[y2 * (nw + 1) + x2] - sum[y1 * (nw + 1) + x2] - sum[y2 * (nw + 1) + x1] + sum[y1 * (nw + 1) + x1];
      return [s, (x2 - x1) * (y2 - y1)];
    };

    const boxes = [];
    for (let i = 0; i < n; i++) {
      const o = i * dim;
      let cls = 0;
      for (let j = 5; j < dim; j++) cls = Math.max(cls, pred[o + j]);
      const conf = pred[o + 4] * cls;
      if (!(conf > confThresh)) continue;
      const cx = pred[o], cy = pred[o + 1], bw = pred[o + 2], bh = pred[o + 3];
      // Drop blocks with (almost) no text pixels under them: false positives.
      const [s, cnt] = area(Math.max(0, Math.trunc(cx - bw / 2)), Math.max(0, Math.trunc(cy - bh / 2)),
        Math.trunc(cx + bw / 2), Math.trunc(cy + bh / 2));
      if (cnt === 0 || s / cnt < 0.04) continue;
      boxes.push(box(sx + (cx - bw / 2) / scale, sy + (cy - bh / 2) / scale,
        sx + (cx + bw / 2) / scale, sy + (cy + bh / 2) / scale, conf));
    }

    // The block head misses some text (notably single horizontal lines in webtoons),
    // while the line map catches it. Group line pixels into blocks (15x15 dilation,
    // then 8-connected components) and add the ones not already covered.
    const grouped = dilate(lines, nw, nh, 7);
    for (const [x0, y0, x1, y1] of components(grouped, nw, nh)) {
      let x = x0, y = y0, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw < 16 || bh < 16 || area(x, y, x + bw, y + bh)[0] < 120) continue;
      x += 6; y += 6; bw -= 12; bh -= 12; // undo dilation growth
      const covered = boxes.some((b) =>
        Math.min(x + bw, (b.x2 - sx) * scale) - Math.max(x, (b.x1 - sx) * scale) > 0 &&
        Math.min(y + bh, (b.y2 - sy) * scale) - Math.max(y, (b.y1 - sy) * scale) > 0);
      if (!covered) boxes.push(box(sx + x / scale, sy + y / scale, sx + (x + bw) / scale, sy + (y + bh) / scale, 0.5));
    }
    stats.tiles++;
    stats.post += performance.now() - tPost;
    stats.pre += tPre - tStart;
    return { boxes, strokes, nw, nh, scale, sx, sy };
  }

  /** Boxes in image pixels, and the stroke map at page size (w x h, 0-255).
   *  Long strips are split into roughly square, overlapping tiles. */
  async detect(source, w, h, confThresh = DETECT_CONF) {
    const stats = { tiles: 0, pre: 0, infer: 0, post: 0 }; // ms, reported in result timings
    const tiles = [];
    if (h > w * 1.5) {
      const step = Math.trunc(w * 0.8), size = w;
      for (let y = 0; y < Math.max(h - size, 0) + step; y += step) {
        const y0 = Math.min(y, Math.max(h - size, 0));
        tiles.push(await this.runTile(source, 0, y0, w, Math.min(size, h - y0), confThresh, stats));
      }
    } else if (w > h * 1.5) {
      const step = Math.trunc(h * 0.8), size = h;
      for (let x = 0; x < Math.max(w - size, 0) + step; x += step) {
        const x0 = Math.min(x, Math.max(w - size, 0));
        tiles.push(await this.runTile(source, x0, 0, Math.min(size, w - x0), h, confThresh, stats));
      }
    } else {
      tiles.push(await this.runTile(source, 0, 0, w, h, confThresh, stats));
    }
    let boxes = tiles.flatMap((t) => t.boxes);
    boxes = boxes.map((b) => box(Math.max(0, b.x1), Math.max(0, b.y1), Math.min(w, b.x2), Math.min(h, b.y2), b.conf))
      .filter((b) => b.w > 6 && b.h > 6);
    const merged = mergeBoxes(nms(boxes, 0.3));
    const strokes = new Uint8Array(w * h);
    for (const t of tiles) {
      for (let py = 0; py < h; py++) {
        const ly = Math.floor((py - t.sy) * t.scale);
        if (ly < 0 || ly >= t.nh) continue;
        for (let px = 0; px < w; px++) {
          const lx = Math.floor((px - t.sx) * t.scale);
          if (lx < 0 || lx >= t.nw) continue;
          const v = t.strokes[ly * t.nw + lx];
          if (v > strokes[py * w + px]) strokes[py * w + px] = v;
        }
      }
    }
    return { boxes: merged, strokes, stats };
  }
}

export function box(x1, y1, x2, y2, conf) {
  return { x1, y1, x2, y2, conf, get w() { return this.x2 - this.x1; }, get h() { return this.y2 - this.y1; } };
}

// Binary dilation with a (2r+1) square: separable running-window max.
function dilate(src, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let count = 0;
    const row = y * w;
    for (let x = 0; x < Math.min(r, w); x++) count += src[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += src[row + x + r];
      if (x - r - 1 >= 0) count -= src[row + x - r - 1];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

// Bounding boxes [x1, y1, x2, y2] (inclusive) of 8-connected components.
function components(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let x1 = w, y1 = h, x2 = -1, y2 = -1;
    while (top) {
      const p = stack[--top];
      const px = p % w, py = (p - px) / w;
      if (px < x1) x1 = px; if (px > x2) x2 = px;
      if (py < y1) y1 = py; if (py > y2) y2 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; }
        }
      }
    }
    out.push([x1, y1, x2, y2]);
  }
  return out;
}

export function nms(boxes, iouThresh) {
  const keep = [];
  for (const b of [...boxes].sort((a, c) => c.conf - a.conf)) {
    const overlaps = keep.some((k) => {
      const ix = Math.max(0, Math.min(b.x2, k.x2) - Math.max(b.x1, k.x1));
      const iy = Math.max(0, Math.min(b.y2, k.y2) - Math.max(b.y1, k.y1));
      return ix * iy > iouThresh * (b.w * b.h + k.w * k.h - ix * iy);
    });
    if (!overlaps) keep.push(b);
  }
  return keep;
}

/** Merge boxes where one is mostly contained in another (tile overlaps, split blocks). */
export function mergeBoxes(boxes) {
  const out = [];
  for (const b of [...boxes].sort((a, c) => c.w * c.h - a.w * a.h)) {
    const o = out.find((o) => {
      const ix = Math.max(0, Math.min(b.x2, o.x2) - Math.max(b.x1, o.x1));
      const iy = Math.max(0, Math.min(b.y2, o.y2) - Math.max(b.y1, o.y1));
      return ix * iy > 0.6 * b.w * b.h;
    });
    if (o) {
      o.x1 = Math.min(o.x1, b.x1); o.y1 = Math.min(o.y1, b.y1);
      o.x2 = Math.max(o.x2, b.x2); o.y2 = Math.max(o.y2, b.y2);
      o.conf = Math.max(o.conf, b.conf);
    } else {
      out.push(box(b.x1, b.y1, b.x2, b.y2, b.conf));
    }
  }
  return out;
}

/** Approximate reading order: row bands top-to-bottom, then RTL (manga) or LTR. */
export function readingOrder(boxes, rtl) {
  const rows = [];
  for (const b of [...boxes].sort((a, c) => a.y1 - c.y1)) {
    const row = rows[rows.length - 1];
    // Joins the current row if it starts within the top half of the row's first box.
    if (row && b.y1 < row[0].y1 + row[0].h * 0.5) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((row) => row.sort((a, c) => (rtl ? c.x2 - a.x2 : a.x1 - c.x1)));
}
