# Tsundoku: planned improvements

Written after reviewing 5.8.0 against an outside list of 22 suggestions. Each item
was checked against the code. Updated for 5.9.0: work through **Next up** in
order; **Later** and **Not planned** record what was decided and why.

## Done in 5.9.0

All nine "Next up" items, plus manga translation from "Later":

1. pdf.js updated to 6.4.299 (advisory fixed); PDF reader checked in a packaged build.
2. `trashOrDelete` no longer deletes permanently when the Recycle Bin refuses a file.
3. `t3` reaches 4.5:1 or more on `bg`, `bg2`, `s1` and `s2` in all 16 themes.
4. Motion follows the system's reduced-motion setting until one is chosen.
5. Dialogs trap Tab, are labelled by their title, and restore focus.
6. Tsumi's loop stops in Performance Mode or with motion off.
7. Settings → Manga names the formats that go to the reader app.
8. The `electron-store` fallback is removed.
9. CI runs on `windows-latest` too (needed `.gitattributes` for LF checkouts).
- **Manga translation in the reader** (`main/services/translate.js`, Translate
  tool `T`). Built from scratch with the same approach as the browser
  extension, which isn't on GitHub. Reworked after the first real test: the
  reader now finds the balloons itself, numbers them for the model, erases
  the original text and letters the translation into each balloon
  (`renderer/typeset.js`). Checked on the owner's page (as a re-lettered
  stand-in) at 1x and 2x; the live model call is still untried here (no key).

## Next up (in order)

1. **Try translation on real chapters** (owner, with a key). 5.10 uses the
   extension's text detector and splits text per balloon; check it on the
   owner's ARM64 PC (WebGPU should be used: the status line never says the
   simpler balloon finder took over), and whether Haiku 5.5 follows the box
   numbers and the split-word rule or Sonnet 5.5 should be the default.
2. **Try the extension 0.7** (`manga-translator/`, owner): it now uses the
   reader's `typeset.js`; check a few reader sites, zooming, and the Text size
   slider.
3. **Electron smoke test in CI** (below): it would have caught the CRLF
   problem and would cover the reader, translation overlay and protocols.
4. **Unescaped HTML check**, then the **empty `catch` pass**.

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
- **Tsumi model picker**: a product decision. Haiku 5.5 stays the fixed choice
  unless a curated list is wanted.
- **Mobile port (Capacitor)**: a separate project.
