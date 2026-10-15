# Changelog

## 0.7.2

- **"Use GPT-6 Luna (medium)" switch** in the popup's Advanced section, under
  the OpenRouter key.
  - With an OpenRouter key and the switch on, pages are translated by OpenAI's
    GPT-6 Luna (`openai/gpt-6-luna`) at medium reasoning instead of Claude
    Haiku 5.5. Same prompt, page images and JSON answer.
  - Luna gets 32,000 output tokens, since its reasoning counts toward them.
  - Luna's translations are cached apart from Haiku's and Gemini's.
  - The popup's status line names the model in use. The switch stays greyed
    out until an OpenRouter key is entered.

## 0.7.1

- **The text detector downloads itself.** A copy of the extension from the
  Tsundoku repository has no model file, and stopped with "Engine error: Text
  detection model missing".
  - On first start the extension now downloads `comictextdetector.pt.onnx`
    (95 MB) from the manga-image-translator releases and checks its SHA-256.
  - The model is kept in the extension's Cache Storage, so it downloads once.
    The popup shows the download progress.
  - A model file in `engine/models` is still used first.
  - A failed download is retried when the popup reopens or a page is
    translated.

## 0.7.0

- **The same translation engine as Tsundoku's reader** (`engine/typeset.js` is one shared file). Before, each detected text block got one box: a block covering two touching balloons got a single translation spread across both, and the text was drawn in the largest rectangle inside the bubble with CSS, falling back to breaking words anywhere. Now:
  - **One translation per balloon.** Blocks are split into units by the balloons the letters sit in (joined balloons into their lobes, balloons cut by the panel edge at their neck), using the detector's letter-stroke map. A line spread over several balloons ("LAUN-" / "DRY!!") is split across them in reading order.
  - **The original text is erased and the translation lettered into the balloon's shape**, row by row, with whole words and consistent sizes across the page. Text on artwork is erased (inpainted where needed) and lettered with a halo where it doesn't cover other text.
  - Sound effects drawn into the art are left as drawn.
- **Fixed: translations trailed behind the page while zooming or panning.** Their position was only re-checked 4 times a second. Each page is now one canvas moved in the same frame as its image: on scroll, on resize (ResizeObserver), and every frame right after wheel, pointer, key and touch input, which covers readers that zoom with CSS transforms.
- **Text size re-letters the page** with the new size (cached translations, about half a second per page) instead of shrinking text inside fixed boxes.
- The engine also accepts the model as published (`comictextdetector.pt.onnx`, the file Tsundoku uses) when the half-precision one isn't there.
- Pages read before are translated again with the new engine (cache version bumped).

## 0.6.0

- **Optional: translate with Claude Haiku 5.5 through OpenRouter.** Paste an OpenRouter key in the popup, under **Advanced**, and every page goes to Claude Haiku 5.5 (low reasoning) instead of Gemini. Clear the field to go back to Gemini. OpenRouter charges per page from your OpenRouter credits; it isn't free like the Gemini key.
- **Translations cover the bubble's real shape.** Before, each translation was a rectangle, and a rectangle can't fit a two-lobe bubble, a cloud bubble or a bubble cut by the panel edge, so text and white boxes spilled over the art. Now the extension traces the bubble's outline and paints over exactly that shape. The text goes in the largest rectangle that fits inside it.
- **Text with no bubble** (text over artwork, outlined lettering, text on a plain panel) is covered only where the original letters are. The translation gets a wider area than a vertical Japanese column and an outline in the background colour, so it's readable over the art.
- **Shortcuts: Alt+Shift+T shows/hides translations, Alt+T opens the extension's panel.** The page also listens for Alt+Shift+T itself, so it works even if the browser hasn't assigned the key.
- Both shortcuts can be changed at `chrome://extensions/shortcuts` (or `brave://`, `edge://`).
- Pages read before are laid out again with the new method (cache version bumped).
- **Fixed: hiding translations did nothing.** The shortcut and **Show translations** in the popup only hid an empty container, while the translations themselves stayed on screen. The same bug let translations show up in the screenshots taken of protected images.

## 0.5.1

- **Fixed: pages read before 0.5.0 still showed the old, overflowing boxes**, because their layouts came from the cache. The cache version is bumped, so they're laid out again with the new method.
- Translation boxes keep a little further from bubble outlines (at most 1.5% of an edge may touch the outline, was 3%). Tested on oval bubbles, bubbles cut by panel borders and image edges, bubbles drawn over panel borders, and touching bubbles.

## 0.5.0

- **Translations stay locked to the page while scrolling.** They used to sit in a layer fixed to the screen and trail a frame behind the images. They're now attached to the page (or to the reader's own scroll box), so the browser scrolls them with the images.
- **Text stays inside its bubble.** The translation box now grows outward from the original text only while it stays inside the bubble's real shape, so it no longer pokes out of round bubbles or spills into a touching bubble.
- **Read-ahead works in readers that scroll inside a box**, not just in readers that scroll the whole page.
- **Latency-based routing.** The extension learns how fast each Gemini model is answering right now and sends each page to the one expected to finish first (counting quota waits). A model that slows down stops getting pages after one slow reply; parallel backup requests go to a different model.
- Fixed: right after the browser starts, the first pages could fail with "Receiving end does not exist" while the engine was still loading.

## 0.4.0

- **No server any more.** Everything runs inside the extension: text detection with ONNX Runtime Web on the GPU (WebGPU, CPU as fallback), and Gemini is called directly. No Python, no terminal window, no `start-server.bat`.
- **Gemini key in the popup.** Paste it under **Advanced**; it opens by itself while no key is saved. The key stays in this browser.
- **Results cached in the browser** (IndexedDB) instead of on disk.
- The detection model is half precision (47 MB, bundled): same boxes as before, twice as fast on the GPU.
- **Panel** popup design, with Fuki the mascot, who falls asleep when something is wrong.

## 0.3.0

- **Much faster on long chapters.** Up to 8 pages are translated at once (was 2), so one slow page no longer holds up the rest. In a 20-page test the typical page took 3 s instead of 12 s.
- **Fewer long waits.** If Gemini hasn't answered after 7 s, a second identical request is sent and the first reply wins. Used only while there's quota to spare.
- **Uses your free-tier quota better.** The free tier allows 15 requests per minute per model. Requests are now counted per minute instead of spaced evenly, so a new chapter starts with a burst, and pages spill over to `gemini-3.1-flash-lite` (its own quota) when the first model's minute is used up.
- **Reads further ahead.** Pages up to 4 screens ahead are translated, and lazy-loaded pages in that range are loaded early. Pages waiting their turn show **Queued**.
- **Smaller text by default, adjustable.** Translations are drawn 20% smaller. **Text size** in the popup changes it (50–125%) on open pages as you drag.

## 0.2.0

- **Runs on Snapdragon (ARM64) PCs.** Text detection moved from OpenVINO/OpenCV to ONNX Runtime, using the NPU when there is one. About 0.3 s per manga page, 0.8 s per webtoon strip.
- **Faster translations.** `gemini-3.5-flash-lite` is now the default model, with `gemini-3.8-flash` as fallback. Requests stuck on Gemini's side are cut off after 25 s and retried. The server learns your free-tier per-minute limit instead of always waiting 4 s between requests.
- **Clearer errors.** Error badges have a **Retry** button, and the popup has **Retry failed**. Pages Gemini refuses to translate say so.
- **No more "Cannot read properties of undefined (reading 'sendMessage')".** After the extension is reloaded or updated, open tabs pick up the new version by themselves.
- **Skips decorative images.** Blurred, faded or stretched backdrops (such as a series cover behind the reader) are no longer translated.
- Setup uses the Python already installed instead of `uv`. `start-server.bat` runs setup on first use. `package.bat` builds a zip to share.

## 0.1.0

- First version: Chrome/Edge/Brave extension, local server with comic text detection, Gemini translation, bubble-fitted overlays, read-ahead and caching.
