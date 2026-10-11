# Manga Translator

Translates manga, manhwa and manhua in place, in Chrome, Edge or Brave. The original text is erased and the translation is lettered into each speech bubble as you read. Everything runs inside the browser: no server, no installs. It's free: translations use your own Gemini free-tier key.

```
page image ──▶ text detection (in the browser, on your GPU) ──▶ one unit per balloon ──page + numbered units──▶ Gemini (free tier)
lettered page (erased + re-lettered balloons) laid over the image ◀── typesetting ◀── translations ◀─────────┘
```

## Install (once)

1. If `extension/engine/models` has no model file (the Tsundoku repository doesn't keep it), download `comictextdetector.pt.onnx` into it: see `extension/engine/models/README.txt`.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`), turn on **Developer mode**, click **Load unpacked** and select the `extension` folder.
3. Get a free Gemini key at <https://aistudio.google.com/apikey>.
4. Click the extension icon. The **Advanced** section opens by itself: paste your key into **Gemini API key**.

The key stays in your browser (it isn't synced or shared) and is only sent to Google's Gemini API.

**Optional: Claude Haiku 5.5 instead of Gemini.** Paste an [OpenRouter key](https://openrouter.ai/keys) under **Advanced** → **OpenRouter API key**. While it's set, every page is translated by Claude Haiku 5.5 (low reasoning) through OpenRouter, paid from your OpenRouter credits. Clear the field to go back to Gemini. Each service's translations are cached separately.

## Use

1. On a reader site, click the extension icon. Then either:
   - turn on **Auto on this site** (remembered per site), or
   - click **Translate!** to translate this page once.

   You can also right-click any image and choose **Translate this image**.
2. **Alt+Shift+T** hides or shows the translations, so you can see the original art. **Alt+T** opens the extension's panel. To use different keys, open `chrome://extensions/shortcuts` (or `edge://`, `brave://`).
3. **Text size** in the popup makes translations bigger or smaller. Pages are re-lettered with the new size in about half a second each; nothing is translated again.

The popup also sets the source language (auto, Japanese, Chinese, Korean) and the target language.

## Troubleshooting

| You see | What to do |
|---|---|
| "Add your Gemini API key" | Paste your key in the popup, under **Advanced**. Then click **Retry** on the badge or **Retry failed** in the popup. |
| "Your Gemini API key isn't valid" | Copy it again from <https://aistudio.google.com/apikey> and paste it in the popup. |
| "Gemini refused this page" | Gemini won't translate some content. Nothing to fix on your side. |
| "Your OpenRouter API key isn't valid" / "out of credits" | Check the key or add credits at <https://openrouter.ai/settings/credits>. Or clear the OpenRouter field to use Gemini. |
| "All Gemini models rate-limited" | You've used your free-tier quota for now. It refills over time. Check yours at <https://aistudio.google.com/rate-limit>. |
| "Manga Translator was reloaded" | Refresh the page. This only shows if the extension was turned off or removed while the page was open. |
| Nothing happens on a site | Make sure **Auto on this site** is on, or click **Translate!**. Very small images (under 300 px) are skipped on purpose. |

## Share it

Run `package.bat`. It creates `dist\manga-translator-<version>.zip` with the extension, this README and the changelog. Your key is never in it. The other person unzips it and follows **Install** with their own key.

## How it works

- **Text detection runs in the browser.** [comic-text-detector](https://github.com/dmMaze/comic-text-detector), in half precision, runs with [ONNX Runtime Web](https://onnxruntime.ai/) on the GPU (WebGPU): about 0.5 s per manga page and 2.7 s per 3200 px webtoon strip on a Snapdragon X Elite. Without WebGPU it uses the CPU, several times slower. It all happens in a hidden extension page, so the model loads once per browser session.
- **Gemini reads and translates in one call per page.** It sees the whole page with numbered boxes drawn on it, so it uses the artwork and reading order as context. Recent lines from the same chapter are sent along to keep names consistent.
- **Speed.** Up to 8 pages are translated at once. The extension measures how fast each Gemini model (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.8-flash`) is answering and sends each page to the one expected to finish first, counting any wait for free quota (the free tier allows 15 requests per minute per model). If Gemini takes over 7 s to answer, a second request goes to a different model and the first reply wins.
- **One unit per balloon.** The detector gives text blocks (a block can span two touching balloons) and a map of the letter strokes. `engine/typeset.js` (the same file as Tsundoku's `renderer/typeset.js`) assigns each letter to the white area around it: a closed balloon, an open one (a balloon cut by the panel edge, cut off at its narrowest neck), or none (text on artwork). Joined balloons are split into their lobes, and lobes with separate text groups are split again. Each unit is numbered for Gemini, so it gets one translation per balloon, and a line spread over several balloons is split across them in reading order.
- **Lettering like a scanlation.** After the translation, each balloon is repainted in its own colour, which erases the original text without touching the outline. The translation is broken into whole words (hyphenating only words that can't fit) and fitted to the balloon's real shape row by row, so it follows round and joined balloons. Text sizes stay consistent across the page; shouted text may stay big. Text on artwork is erased (flat fill on plain paper, inpainted elsewhere) and lettered with a halo in the nearest light area, never over other text or the balloon outlines.
- **Drawn as one image per page.** The engine returns the lettered page as a transparent image holding only what changed. The page shows it on a canvas laid exactly over the image. It's moved in the same frame as the image: on scroll, when the image is resized (ResizeObserver), and every frame for a moment after a wheel, pointer, key or touch input (readers that zoom with CSS transforms), so it never trails behind.
- **Read-ahead and cache.** Images up to four screens ahead are translated before you reach them; lazy-loaded pages in that range are loaded early. Results are cached in the browser, so re-reading a chapter is instant and costs no quota. Images with no text never reach Gemini.

How images are obtained:

| Situation | Method |
|---|---|
| Normal `<img>` | Fetched by the extension with the page as Referer, which gets past hotlink protection |
| `blob:` / `data:` images | Read inside the page |
| `<canvas>` readers | Read from the canvas. If the canvas is tainted, a screenshot of the visible area is used instead |
| Protected images (HTTP 4xx) | Screenshot fallback. Tall canvases are captured piece by piece as you scroll |

## Project layout

```
extension/                 The browser extension (load this folder with "Load unpacked")
  background.js            Routes requests, Referer workaround, screenshots
  content.js, overlay.css  Finds images on the page and lays the lettered pages over them
  popup.*                  The popup (Panel design)
  engine/                  Runs in a hidden page: detection, typesetting, Gemini, cache
    typeset.js             Balloon units + lettering, shared with Tsundoku (keep the two identical)
    lib/ort/               ONNX Runtime Web 1.30 (MIT)
    models/                The text detection model (not in Git: see README.txt there)
design-options/            Alternative popup designs and their preview
dev/test_pages/            Synthetic Japanese, Korean and Chinese test pages
package.bat                Builds a zip to share
```

## Development

- After changing the extension, click the reload icon on its card in `chrome://extensions`. Open tabs pick up the new version automatically.
- The engine's console (errors, Gemini timings) is in `chrome://extensions` → Manga Translator → **Inspect views: offscreen.html**.
- Each translated page's result includes timings (detection on GPU/CPU, model time per tile, Gemini time) for checking speed.

## Known limitations

- Canvas readers that redraw the same canvas when you turn a page aren't detected as a new page. Right-click the image and choose **Translate this image** again.
- Images set as CSS `background-image` aren't picked up.
- Text on busy artwork is inpainted from its surroundings, which can leave a soft patch where the letters were.
- Sound effects drawn into the art stay untranslated, as in most scanlations.
- If the detector misses part of a line (for example, large stylised lettering), that part stays untranslated and uncovered.
