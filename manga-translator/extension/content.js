// Content script: finds manga images on the page, requests translations (with
// read-ahead prefetching) and lays the lettered page from the engine (a transparent
// image holding only the erased and re-lettered balloons) over each image.
(() => {
  // When the extension is reloaded or updated, copies already running in open tabs
  // lose their connection to it ("stale"). The background script injects a fresh
  // copy into open tabs, which tells any older copy to shut down. (A stale copy
  // can't reliably tell it is stale, so the newest copy always wins.)
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  document.dispatchEvent(new CustomEvent("mt-takeover"));
  const STALE = "Extension was reloaded";

  // Keep in sync with settings.js (content scripts can't import modules).
  const DEFAULTS = {
    srcLang: "auto",
    tgtLang: "en",
    enabledSites: {},
    minSize: 300,
    showOverlay: true,
    textScale: 1,
  };
  const PREFETCH_MARGIN = "400% 0px 400% 0px"; // translate ~4 screens ahead
  // The engine spreads requests over Gemini models and their per-minute quotas.
  const MAX_IN_FLIGHT = 8;

  let settings = { ...DEFAULTS };
  let running = false;
  let mo = null;
  let loopTimer = null;
  const tracked = new Map(); // element -> state
  const queue = new Set(); // elements waiting for translation
  let inFlight = 0;

  // ---------------------------------------------------------------- helpers
  function topHost() {
    try {
      return window.top.location.host;
    } catch {
      const ao = location.ancestorOrigins;
      return ao && ao.length ? new URL(ao[ao.length - 1]).host : location.host;
    }
  }

  const ctxKey = () => topHost() + location.pathname;

  function send(msg) {
    if (!alive()) return Promise.reject(new Error(STALE));
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resp?.ok ? resolve(resp.result) : reject(new Error(resp?.error || "No response"));
      });
    });
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  function elementKey(el) {
    if (el instanceof HTMLImageElement) return el.currentSrc || el.src;
    return "canvas:" + el.width + "x" + el.height;
  }

  function isCandidate(el) {
    const min = settings.minSize;
    if (el instanceof HTMLImageElement) {
      if (!el.complete || !el.naturalWidth) return false;
      if (el.naturalWidth < min * 0.6 || el.naturalHeight < min * 0.6) return false;
      if (Math.max(el.naturalWidth, el.naturalHeight) < min) return false;
    } else if (el instanceof HTMLCanvasElement) {
      if (el.width < min || el.height < min * 0.6) return false;
    } else {
      return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 150 || r.height < 100) return false; // skip thumbnails
    return !looksDecorative(el, r);
  }

  // Readers often show the series cover as a blurred / faded / stretched backdrop
  // behind the pages. Its text (title, author) isn't worth translating, and its
  // overlay would land on top of the real page.
  function looksDecorative(el, r) {
    const nw = el instanceof HTMLImageElement ? el.naturalWidth : el.width;
    const nh = el instanceof HTMLImageElement ? el.naturalHeight : el.height;
    if (Math.abs(Math.log(r.width / r.height / (nw / nh))) > 0.2) return true; // distorted / cropped
    if (r.width > nw * 3) return true; // a small image blown up to fill the screen
    for (let e = el, i = 0; e && e !== document.body && i < 6; e = e.parentElement, i++) {
      const cs = getComputedStyle(e);
      if (parseFloat(cs.opacity) < 0.5 || cs.visibility === "hidden" || cs.filter.includes("blur")) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- overlay
  // Overlays live in layers attached to the page, not fixed to the screen: one in the
  // document, plus one inside each scroll box that holds images (readers that scroll
  // a container instead of the page). Overlays are positioned relative to their layer,
  // so the browser scrolls them together with the images, with no lag. Positions only
  // need updating when the layout changes, not on scroll.
  const layers = new Map(); // scroll container (null = document) -> layer element
  const madeRelative = new Set(); // containers we set position: relative on (restored on stop)

  function ensureLoop() {
    document.documentElement.classList.toggle("mt-hide", !settings.showOverlay);
    if (loopTimer) return;
    // Overlays follow their image in the same frame it moves: on scroll (any scroll
    // box), on resize (ResizeObserver per image, see getOverlay), and for a moment after
    // every wheel / pointer / key / touch input, which covers readers that zoom or pan
    // with CSS transforms (no resize or scroll event). The timer is only a backstop
    // for layout changes nothing reports (e.g. a sidebar opening).
    loopTimer = setInterval(updatePositions, 500);
    addEventListener("resize", updatePositions, { passive: true });
    addEventListener("scroll", updatePositions, { passive: true, capture: true });
    for (const t of ["wheel", "pointerdown", "pointermove", "pointerup", "keydown", "touchmove", "transitionrun", "animationstart"]) {
      addEventListener(t, follow, { passive: true, capture: true });
    }
  }

  function stopLoop() {
    if (!loopTimer) return;
    clearInterval(loopTimer);
    loopTimer = null;
    removeEventListener("resize", updatePositions, { passive: true });
    removeEventListener("scroll", updatePositions, { passive: true, capture: true });
    for (const t of ["wheel", "pointerdown", "pointermove", "pointerup", "keydown", "touchmove", "transitionrun", "animationstart"]) {
      removeEventListener(t, follow, { passive: true, capture: true });
    }
  }

  // Re-check positions every frame until ~600 ms after the last input (zoom and pan
  // animations, smooth scrolling), then stop.
  let followUntil = 0;
  let following = false;
  function follow(e) {
    if (e.type === "pointermove" && !e.buttons) return; // only drags
    followUntil = performance.now() + 600;
    if (following) return;
    following = true;
    const tick = () => {
      updatePositions();
      if (performance.now() < followUntil && loopTimer) requestAnimationFrame(tick);
      else following = false;
    };
    requestAnimationFrame(tick);
  }

  // Images resized by the reader (zoom buttons, fit-to-width, window size): the
  // callback runs after layout and before paint, so the overlay moves in the same frame.
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const state = tracked.get(e.target);
      if (state) updateOne(e.target, state);
    }
  });

  function scrollContainer(el) {
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const scrolls = (v) => v === "auto" || v === "scroll" || v === "overlay";
      if ((scrolls(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) ||
          (scrolls(cs.overflowX) && e.scrollWidth > e.clientWidth + 1)) return e;
    }
    return null;
  }

  function layerFor(el) {
    const container = scrollContainer(el);
    let layer = layers.get(container);
    if (layer?.isConnected) return layer;
    layer = document.createElement("div");
    layer.className = "mt-layer";
    if (container) {
      // The layer is positioned against the container, so the container must be a
      // containing block. Most already are; otherwise make it one (undone on stop).
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
        madeRelative.add(container);
      }
      container.appendChild(layer);
    } else {
      document.documentElement.appendChild(layer);
    }
    layers.set(container, layer);
    return layer;
  }

  function removeLayers() {
    for (const layer of layers.values()) layer.remove();
    layers.clear();
    for (const c of madeRelative) c.style.position = "";
    madeRelative.clear();
  }

  // Text size changed: the engine re-letters every page with the new size. The
  // translations are cached, so this doesn't ask the translation service again; the
  // current lettering stays up until the new one replaces it.
  function reletterAll() {
    for (const [el, state] of tracked) {
      if (state.status !== "done" || !state.results.length) continue;
      if (state.mode === "capture") {
        // Screenshot pieces are taken again as they come into view.
        state.overlay?.querySelectorAll(".mt-page").forEach((c) => c.remove());
        state.results = [];
      }
      state.status = "idle";
      state.reletter = true;
      enqueue(el, true);
    }
  }

  function getOverlay(el, state) {
    if (!state.overlay?.isConnected) {
      ensureLoop();
      state.overlay ||= Object.assign(document.createElement("div"), { className: "mt-ov" });
      state.layer = layerFor(el);
      state.layer.appendChild(state.overlay);
      state.posSig = null;
      ro.observe(el);
      updateOne(el, state);
    }
    return state.overlay;
  }

  function retry(el) {
    const state = tracked.get(el);
    if (!state || state.status !== "error") return;
    state.status = "idle";
    state.results = [];
    enqueue(el, true);
  }

  function setBadge(el, state, kind, text) {
    const ov = getOverlay(el, state);
    let badge = ov.querySelector(".mt-badge");
    if (!kind) return badge?.remove();
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "mt-badge";
      const label = document.createElement("span");
      label.className = "mt-badge-text";
      const btn = document.createElement("button");
      btn.className = "mt-retry";
      btn.type = "button";
      btn.textContent = "Retry";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        retry(el);
      });
      badge.append(label, btn);
      ov.appendChild(badge);
    }
    badge.dataset.kind = kind;
    badge.firstChild.textContent = text;
    badge.title = text;
  }

  // Shown once when this copy is stale and no fresh copy has taken over
  // (e.g. the extension was turned off): only a page reload can help then.
  function showStaleNotice() {
    stop();
    if (replaced || document.getElementById("mt-stale")) return;
    const n = document.createElement("div");
    n.id = "mt-stale";
    n.textContent = "Manga Translator was reloaded. Refresh this page to keep translating.";
    n.addEventListener("click", () => n.remove());
    document.documentElement.appendChild(n);
  }

  // The engine's lettered page: a PNG data URL of only the pixels that changed (the
  // erased balloons with the translation lettered in), the size of the image (or
  // screenshot piece). Decoded here rather than loaded as an <img>, so the page's
  // Content-Security-Policy can't block it; drawn on a canvas sized in % of the
  // overlay, so it scales with the image at any zoom.
  async function decodeImage(dataUrl) {
    const [head, b64] = dataUrl.split(",");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: head.slice(5).split(";")[0] }));
  }

  async function renderResult(el, state, result, region, replace = false) {
    const bmp = result.image ? await decodeImage(result.image) : null;
    if (tracked.get(el) !== state) return bmp?.close();
    const ov = getOverlay(el, state);
    if (replace) ov.querySelectorAll(".mt-page").forEach((c) => c.remove());
    if (!bmp) return; // no text on this image
    const page = document.createElement("canvas");
    page.className = "mt-page";
    page.width = bmp.width;
    page.height = bmp.height;
    page.getContext("bitmaprenderer").transferFromImageBitmap(bmp);
    page.style.left = region.x0 * 100 + "%";
    page.style.top = region.y0 * 100 + "%";
    page.style.width = (region.x1 - region.x0) * 100 + "%";
    page.style.height = (region.y1 - region.y0) * 100 + "%";
    ov.insertBefore(page, ov.querySelector(".mt-badge")); // the badge stays on top
  }

  function updateOne(el, state) {
    const ov = state.overlay;
    if (!ov) return;
    if (!ov.isConnected) return getOverlay(el, state); // the site re-rendered our layer away
    const r = el.getBoundingClientRect();
    const l = state.layer.getBoundingClientRect();
    // Offset from the layer: unchanged by scrolling, which moves both together.
    const x = Math.round((r.left - l.left) * 10) / 10;
    const y = Math.round((r.top - l.top) * 10) / 10;
    const hidden = r.width === 0 || r.height === 0;
    // Only touch styles when something changed, to avoid constant repaints.
    const sig = hidden ? "hidden" : `${x},${y},${r.width},${r.height}`;
    if (sig === state.posSig) return;
    state.posSig = sig;
    if (hidden) {
      ov.style.display = "none";
      return;
    }
    ov.style.display = "";
    ov.style.transform = `translate(${x}px, ${y}px)`;
    ov.style.width = r.width + "px";
    ov.style.height = r.height + "px";
  }

  function updatePositions() {
    for (const [el, state] of tracked) {
      if (!el.isConnected) {
        forget(el);
        continue;
      }
      updateOne(el, state);
      if (state.mode === "capture" && state.status === "done") maybeRecapture(el, state);
    }
  }

  function clearOverlay(state) {
    state.overlay?.remove();
    state.overlay = null;
  }

  function forget(el) {
    const state = tracked.get(el);
    if (state) clearOverlay(state);
    tracked.delete(el);
    queue.delete(el);
    unwatch(el);
    ro.unobserve(el);
  }

  // ---------------------------------------------------------------- queue
  function enqueue(el, force = false) {
    if (!force && !isCandidate(el)) return;
    let state = tracked.get(el);
    const key = elementKey(el);
    if (!state || state.key !== key) {
      if (state) clearOverlay(state);
      state = { key, status: "idle", results: [], overlay: null, mode: "fetch" };
      tracked.set(el, state);
    }
    if (state.status !== "idle") return;
    state.status = "queued";
    queue.add(el);
    pump();
    if (state.status === "queued" && !state.reletter) setBadge(el, state, "queued", "Queued"); // not started yet
  }

  function distanceToViewport(el) {
    const r = el.getBoundingClientRect();
    if (r.bottom >= 0 && r.top <= innerHeight) return 0;
    return r.top > innerHeight ? r.top - innerHeight : -r.bottom;
  }

  function pump() {
    while (inFlight < MAX_IN_FLIGHT && queue.size) {
      // Closest to the viewport first: what you're reading now, then what's next.
      let best = null;
      let bestD = Infinity;
      for (const el of queue) {
        const d = distanceToViewport(el);
        if (d < bestD) [best, bestD] = [el, d];
      }
      queue.delete(best);
      inFlight++;
      process(best).finally(() => {
        inFlight--;
        pump();
      });
    }
  }

  async function process(el) {
    const state = tracked.get(el);
    if (!state) return;
    const key = state.key;
    state.status = "working";
    if (!state.reletter) setBadge(el, state, "busy", "Translating…");
    state.reletter = false;
    try {
      let result;
      const base = { ctx: ctxKey() };
      if (el instanceof HTMLImageElement && /^https?:/.test(key) && state.mode === "fetch") {
        try {
          result = await send({ type: "translate-url", src: key, pageUrl: location.href, ...base });
        } catch (e) {
          if (!/fetch|HTTP 4|Not an image/i.test(e.message)) throw e;
          state.mode = "capture"; // protected image: fall back to a screenshot
        }
      } else if (el instanceof HTMLImageElement && /^(blob|data):/.test(key)) {
        const blob = await (await fetch(key)).blob();
        result = await send({ type: "translate-data", dataUrl: await blobToDataUrl(blob), ...base });
      } else if (el instanceof HTMLCanvasElement && state.mode === "fetch") {
        try {
          result = await send({ type: "translate-data", dataUrl: el.toDataURL("image/png"), ...base });
        } catch (e) {
          if (e.name !== "SecurityError") throw e;
          state.mode = "capture"; // tainted canvas
        }
      }
      if (state.mode === "capture") {
        await captureAndTranslate(el, state);
      } else if (tracked.get(el) === state && state.key === key) {
        const whole = { x0: 0, y0: 0, x1: 1, y1: 1 };
        state.results = [{ region: whole, result }];
        await renderResult(el, state, result, whole, true);
      }
      if (tracked.get(el) === state) {
        state.status = "done";
        setBadge(el, state, null);
      }
    } catch (e) {
      if (!alive()) return showStaleNotice();
      if (tracked.get(el) !== state) return;
      state.status = "error";
      setBadge(el, state, "error", "⚠ " + e.message);
      console.warn("[manga-translator]", e);
    }
  }

  // ------------------------------------------------- screenshot fallback
  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left);
    const y0 = Math.max(0, r.top);
    const x1 = Math.min(innerWidth, r.right);
    const y1 = Math.min(innerHeight, r.bottom);
    if (x1 <= x0 || y1 <= y0) return null;
    return { r, vis: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
  }

  function coveredFraction(state, region) {
    // Vertical coverage of `region` by previous captures.
    let covered = 0;
    for (const { region: c } of state.results) {
      covered += Math.max(0, Math.min(c.y1, region.y1) - Math.max(c.y0, region.y0));
    }
    return covered / Math.max(1e-6, region.y1 - region.y0);
  }

  function regionOf(r, vis) {
    return {
      x0: (vis.x - r.left) / r.width,
      y0: (vis.y - r.top) / r.height,
      x1: (vis.x + vis.width - r.left) / r.width,
      y1: (vis.y + vis.height - r.top) / r.height,
    };
  }

  async function captureAndTranslate(el, state) {
    // Wait until enough of the element is on screen to be worth capturing.
    for (;;) {
      const v = visibleRect(el);
      if (v && v.vis.height >= Math.min(v.r.height, innerHeight) * 0.8) break;
      setBadge(el, state, "busy", "Scroll here to translate");
      await sleep(400);
      if (tracked.get(el) !== state) return;
    }
    setBadge(el, state, "busy", "Translating…");
    document.documentElement.classList.add("mt-capturing"); // keep our own overlays out of the screenshot
    await nextFrame();
    const { r, vis } = visibleRect(el);
    let dataUrl;
    try {
      dataUrl = await send({ type: "capture", rect: vis, dpr: devicePixelRatio });
    } finally {
      document.documentElement.classList.remove("mt-capturing");
    }
    const region = regionOf(r, vis);
    const result = await send({ type: "translate-data", dataUrl, ctx: ctxKey() });
    if (tracked.get(el) !== state) return;
    state.results.push({ region, result });
    await renderResult(el, state, result, region);
  }

  function maybeRecapture(el, state) {
    // Tall canvases (webtoon readers) are captured piece by piece as you scroll.
    const v = visibleRect(el);
    if (!v || v.vis.height < Math.min(v.r.height, innerHeight) * 0.8) return;
    if (coveredFraction(state, regionOf(v.r, v.vis)) < 0.6) {
      state.status = "queued";
      queue.add(el);
      pump();
    }
  }

  // ---------------------------------------------------------------- scanning
  // Readers often lazy-load pages: natively (loading="lazy"), or with a script that
  // swaps a placeholder for the real URL in data-src as you scroll. Within the
  // read-ahead range, load them early so they can be translated before you get there.
  const lazySrc = (img) => img.dataset.src || img.dataset.lazySrc || img.dataset.original || "";
  const isPlaceholder = (img) =>
    !!lazySrc(img) && lazySrc(img) !== img.getAttribute("src") && (!img.complete || img.naturalWidth < 50);

  function loadEarly(img) {
    if (img.loading === "lazy") img.loading = "eager";
    if (isPlaceholder(img)) img.src = new URL(lazySrc(img), location.href).href;
  }

  // Read-ahead is measured against the element's scroll root: the page, or the reader's
  // own scroll box (otherwise images below the box's visible part never count as near).
  const watchers = new Map(); // scroll root (null = page) -> { io, lazyIo }

  function watchersFor(el) {
    const container = scrollContainer(el);
    let w = watchers.get(container);
    if (!w) {
      const opts = { root: container, rootMargin: PREFETCH_MARGIN };
      w = {
        io: new IntersectionObserver((entries) => {
          for (const e of entries) if (e.isIntersecting) enqueue(e.target);
        }, opts),
        lazyIo: new IntersectionObserver((entries) => {
          for (const e of entries) if (e.isIntersecting) loadEarly(e.target);
        }, opts),
      };
      watchers.set(container, w);
    }
    return w;
  }

  function unwatch(el) {
    for (const w of watchers.values()) {
      w.io.unobserve(el);
      w.lazyIo.unobserve(el);
    }
  }

  function consider(el) {
    if (!running || !(el instanceof HTMLImageElement || el instanceof HTMLCanvasElement)) return;
    if (el.closest(".mt-layer")) return; // our own lettered pages
    const w = watchersFor(el);
    if (el instanceof HTMLImageElement && (!el.complete || !el.naturalWidth || isPlaceholder(el))) {
      el.addEventListener("load", () => consider(el), { once: true });
      w.lazyIo.observe(el);
      return;
    }
    unwatch(el);
    w.io.observe(el); // IntersectionObserver always reports the initial state
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches("img, canvas")) consider(node);
    node.querySelectorAll?.("img, canvas").forEach(consider);
  }

  function start() {
    if (running) return;
    running = true;
    send({ type: "warmup" }).catch(() => {});
    ensureLoop();
    mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "attributes") {
          const st = tracked.get(m.target);
          if (st) {
            clearOverlay(st);
            tracked.delete(m.target);
          }
          consider(m.target);
        } else {
          m.addedNodes.forEach(scan);
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "width", "height"],
    });
    scan(document.documentElement);
  }

  function stop() {
    running = false;
    for (const w of watchers.values()) {
      w.io.disconnect();
      w.lazyIo.disconnect();
    }
    watchers.clear();
    mo?.disconnect();
    for (const el of [...tracked.keys()]) forget(el);
    queue.clear();
    removeLayers();
    stopLoop();
  }

  function resetAll() {
    if (!running) return;
    stop();
    start();
  }

  // ---------------------------------------------------------------- wiring
  let replaced = false;
  let reletterTimer = null;
  document.addEventListener("mt-takeover", () => { // a fresh copy replaced us
    replaced = true;
    stop();
  }, { once: true });

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    respond(true); // lets the popup tell a live copy from a missing one
    if (msg.type === "start") start();
    else if (msg.type === "stop") stop();
    else if (msg.type === "retry-failed") [...tracked.keys()].forEach(retry);
    else if (msg.type === "translate-image") {
      const img = [...document.images].find((i) => i.currentSrc === msg.srcUrl || i.src === msg.srcUrl);
      if (!img) return;
      if (!running) ensureLoop();
      const st = tracked.get(img);
      if (st?.status === "error") st.status = "idle";
      enqueue(img, true);
    }
  });

  // Alt+Shift+T shows/hides the translations. The browser shortcut (manifest "commands")
  // isn't always assigned (e.g. an existing install keeps its old key, or another
  // extension took it), so the page listens too; the background ignores a double toggle.
  window.addEventListener("keydown", (e) => {
    if (replaced || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== "KeyT") return;
    if (!document.querySelector(".mt-layer")) return; // nothing translated here: leave the key to the page
    e.preventDefault();
    send({ type: "toggle-overlay" }).catch(() => {});
  }, true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue ?? DEFAULTS[k];
    if (changes.showOverlay) document.documentElement.classList.toggle("mt-hide", !settings.showOverlay);
    if (changes.textScale) {
      clearTimeout(reletterTimer); // the slider sends several values while dragging
      reletterTimer = setTimeout(reletterAll, 400);
    }
    if (changes.enabledSites) settings.enabledSites[topHost()] ? start() : stop();
    if (changes.srcLang || changes.tgtLang || changes.minSize) resetAll();
  });

  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    if (settings.enabledSites[topHost()]) start();
  });
})();
