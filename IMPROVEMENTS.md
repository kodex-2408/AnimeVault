# Tsundoku: planned improvements

Written after reviewing 5.8.0 against an outside list of 22 suggestions. Each item
was checked against the code. Work through **Next up** in order; **Later** and
**Not planned** record what was decided and why.

## Next up (in order)

1. **Update pdf.js (security).** `pdfjs-dist` 5.7.284 ships inside the app and has a
   high-severity advisory (`npm audit --omit=dev`), fixed in 6.2.108 and later. Update
   it and re-check the PDF reader (`renderer/reader.js` loads `build/pdf.min.mjs` and
   `pdf.worker.min.mjs`). Then re-test in a packaged build, since the module loads
   from inside app.asar.
2. **Stop permanent deletes when the Recycle Bin fails.** `trashOrDelete` in
   `main/config/security.js` falls back to `fs.rmSync` on any `shell.trashItem` error.
   That error can also come from a file in use, a long path or an OneDrive
   placeholder. Fall back only when the drive has no Recycle Bin. For any other error,
   keep the files and show the error.
3. **Readable tertiary text.** `t3` in all 16 themes (`renderer/theme.js`) measures
   3.3 to 3.8:1 on light themes and 3.6 to 4.6:1 on dark themes, against the base and
   raised surfaces. Retune each value to at least 4.5:1 on `bg` and `s1`.
4. **Respect reduced motion.** Nothing reads `prefers-reduced-motion`. When the
   Windows animation setting is off and the user has not chosen a Motion setting, use
   `animSpeed: 'none'`. An explicit in-app choice still wins.
5. **Dialog focus.** `openModal` in `renderer/core.js` should keep Tab inside the open
   dialog and return focus to the element that opened it when the dialog closes.
6. **Luma's animation loop.** `_lumaTick` in `renderer/luma.js` keeps running in
   Performance Mode at 70% speed. Stop the loop, and show Luma standing still, when
   Performance Mode is on or motion is off.
7. **Say which formats go to the reader app.** Add one line in Settings → Manga:
   HUFF/CDIC MOBI, AZW3 and PDFs over 1 GB open in the reader app. Extending the
   built-in reader to these formats is not worth it.
8. **Remove the dead `electron-store` fallback** from `loadConfig`
   (`main/config/config.js`). It is not a dependency, and its error is already
   swallowed.
9. **Windows CI job.** Add `windows-latest` to `.github/workflows/test.yml` next to
   Ubuntu. The suites are plain Node, so path handling, drive letters and
   cross-drive moves would then run on Windows.

## Later

- **Electron smoke test in CI.** Turn the Playwright scripts used by hand during
  development into a CI job under Xvfb. It should cover the `cover://` and `page://`
  protocols, the reader in every format, fullscreen, and a packaged
  `electron-builder --linux dir` build.
- **Electron fuses.** Re-enable them, then build for ARM64 and confirm on the
  owner's ARM64 PC that `win-arm64-unpacked\Tsundoku.exe` still starts.
- **Empty `catch` blocks (49).** Most are deliberate: best-effort cleanup, logging,
  JSON parsing. Do a targeted pass that surfaces the failures a user should know
  about, rather than logging everything.
- **Unescaped HTML check.** Add a test that flags interpolations without
  `E()`/`A()` in the riskiest views: MAL titles, Nyaa results, file names. The
  CSP already blocks inline scripts, and book HTML is sanitized.
- **Light ESLint setup** for `main/`, the root modules and `renderer/`. Full
  TypeScript is not worth it here.
- **qBittorrent WebUI integration**, for real download progress (roadmap).
- **Manga translation in the reader.** Reuse Luma's OpenRouter key and an
  image-capable model. Send pages from the main process, draw translated boxes
  over the page scaled with zoom, cache results per page, and make it opt-in per
  chapter because each page costs money. Needs the existing `manga-translator`
  browser extension pushed to GitHub so its prompts and overlay logic can be
  reused.

## Not planned (and why)

- **Splitting large files** (`autoDownload.js`, `renderer/data.js`, `mal.js`, …):
  only while already working in that code.
- **ES modules for the renderer, or reworking the source-extraction tests**: big,
  risky refactors with little benefit you would notice.
- **Removing `style-src 'unsafe-inline'`**: low risk with `script-src 'self'`,
  and a large change.
- **Code signing and auto-update**: a certificate costs about $100–400 a year
  (Azure Trusted Signing about $10 a month). Not worth it for personal use.
- **Build-tool `npm audit` advisories**: build-time only and never shipped. Review
  them when electron-builder is upgraded.
- **`dist\` in the project folder**: local build output that git ignores. Delete
  it when space is needed.
- **Luma model picker**: a product decision. Haiku 5.5 stays the fixed choice
  unless a curated list is wanted.
- **Mobile port (Capacitor)**: a separate project.
