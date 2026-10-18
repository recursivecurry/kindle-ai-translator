# Validation and release gates

Scope: migration from the external-API reader to explicit, current-page-only local translation. Public release remains gated on the device, provenance and legal checks below.

## Implemented and checked

- [x] Manifest V3, Chrome 138 minimum, temporary `activeTab` access, no persistent host grants or automatic content scripts.
- [x] `captureVisibleTab` capture, cropped to visible reader rectangles before OCR; no Kindle image fetching or internal-renderer bridge.
- [x] Translation starts only from a panel button. No page turning, pretranslation, previous-page view or runtime multi-page cache.
- [x] Packaged Tesseract.js 7 worker, core and ten OCR language data files; no runtime CDN dependency. OCR runs in the extension panel's worker with IndexedDB caching disabled.
- [x] Feature and language-pair detection through `Translator.availability`, model preparation through `Translator.create`, download progress, safe unsupported/failure UI and retry.
- [x] Sequential bounded paragraph translation, per-operation translator reuse, cancellation and resource cleanup. No external translation fallback.
- [x] Text results in a separate side panel; original reader is unchanged. Duplicate starts are disabled while a job runs.
- [x] Page/image/layout/visibility changes, navigation, tab switching, cancel and panel closure invalidate results and pending jobs.
- [x] No source/translation/image writes to extension storage, localStorage or IndexedDB; no content logs or raw third-party exception messages in the UI. Legacy credentials/settings are deleted on upgrade.
- [x] Current-tree book screenshots removed; browser fixtures use original synthetic prose. No secret-pattern findings in the targeted source/history scan; this is not a full provenance audit.
- [x] English/Korean README and design docs updated; PRIVACY and MIT LICENSE added; OCR notices cover all bundled languages. Chrome translation models are not redistributed.
- [x] Automatic release workflow leaves packages as drafts for manual release review.

## Automated evidence

`npm run check` runs TypeScript, ESLint and Prettier. `npm test` covers translation chunking/order, feature detection, download progress/failure, late cancellation, empty translations, OCR cancellation and existing OCR/layout utilities.

`npm run test:integration` loads the packaged extension in Playwright Chromium. Browser tab/capture APIs and Translator are mocked; Tesseract worker, WebAssembly, language data, recognition and the panel code run locally. The synthetic fixture is two original garden sentences, with a separate outside-region sentinel. The test verifies the sentinel never enters translation, output is inserted as text, no content/model cache is written, errors do not expose raw content, retries work, cancel prevents late output, and page/tab changes clear results. A separate DOM fixture exercises the real observer's bounds, image changes and hidden-image detection.

A local run on 2026-10-18 processed capture/decode, real OCR and mocked translation in approximately 308 ms. No external HTTP(S) request was observed in that test. This is a synthetic development measurement, not a real-device translation benchmark or proof about Chrome's browser-managed downloads.

## Actual Chrome translation smoke test

On 2026-10-18, the connected desktop Chrome browser reported `Chrome/155.0.0.0` and exposed the native Translator API. A temporary localhost test page imported an esbuild bundle of the repository's actual `src/translation.ts` adapter. Clicking its button exercised `prepareTranslator` and `translate` with the native English → Korean model, without mocks.

The original fixture was: “The quiet garden was full of morning light. A small bird waited beside the wooden gate.” Chrome returned: “조용한 정원은 아침 햇살로 가득했습니다. 나무 문 옆에서 작은 새가 기다리고 있었다.” The first run took 5,161 ms including model setup; a second run took 138 ms including a fresh translator instance. The first run displayed the adapter's model-download preparation status; download bytes were not measured.

This confirms the adapter can translate that fixture in the actual browser on a localhost origin. It does not establish OCR quality or network isolation of the real model. Extension-origin and capture checks were subsequently exercised in the test below.

## Actual loaded-extension test

After the user loaded `dist`, the extension was tested in the same desktop Chrome on `read.amazon.com` using the cover and a two-column opening spread of *Alice's Adventures in Wonderland*. No capture, OCR or Translator API was mocked.

The first toolbar invocation opened the panel but left the extension without site access. Starting translation then reported that no supported Kindle tab was available. The toolbar's access indicator confirmed that permission was missing. Automatic `openPanelOnActionClick` handling was replaced with an explicit `chrome.action.onClicked` handler that calls `chrome.sidePanel.open`. After the user reloaded the extension, the toolbar indicator showed granted site access and the full capture → packaged OCR → native English-to-Korean translation pipeline completed.

Observed results:

- The cover produced six recognized/translated paragraphs, with poor recognition of decorative lettering.
- The opening spread produced twelve recognized/translated paragraphs in the side panel while preserving the reader.
- A manual page turn cleared the old result without starting another translation.
- Switching to another browser tab cleared the result; returning did not restore it.
- Cancelling an active operation cleared the result and re-enabled the controls. A subsequent retry completed successfully.
- Closing and reopening the panel reset it to an empty result and its initial status.
- Translation quality did not pass a fidelity review: a riverbank was translated as a financial institution, and part of one visible paragraph was missing from the output. A separate native-Translator comparison using the visually transcribed paragraph reproduced the same truncation without OCR. Replacing the colon with a period or translating the clauses separately recovered more content but still omitted the trailing fragment. Native-model fidelity remains a release blocker; this was not a successful quality benchmark.

Screenshots were retained only in the ignored local `artifacts` directory, not committed or distributed. Actual extension network isolation, offline/restart behavior, other platforms/domains/layouts, model download size and resource usage remain unverified.

## Network inventory

| Path | Data and destination |
| --- | --- |
| OCR worker/core/traineddata | Extension-packaged `chrome-extension://` resources only |
| Chrome Translator | Text passed to the browser's on-device API; browser may download its translation models |
| Capture and page observer | In-memory extension/tab communication; rectangles and revision only from observer |
| Extension backend/analytics/errors/CDN | None |
| Kindle reader itself | Site-managed requests outside this extension's control |

The extension-page CSP permits only local packaged connections. Development dependency installation, GitHub operations and release uploads are build/review activities, not runtime book-data paths.

## Required before a public release

- [x] On the tested desktop Chrome device, verify English → Korean in the extension side panel, toolbar-granted capture and user activation with an actual Kindle spread.
- [ ] Verify first model download and browser restart with cached models in the extension context.
- [ ] In browser/network tooling, inspect real-model runs and confirm book images/text/translations/metadata are not transmitted. Distinguish Chrome model downloads from Kindle's own traffic.
- [ ] Test offline use with installed models, offline/missing models, browser policy restrictions, permission denial, switching windows, panel closure and rapid actual Kindle page changes.
- [ ] Test supported Kindle domains and book layouts, including iframe behavior. An unsupported layout must fail clearly; do not introduce internal extraction as a workaround.
- [ ] Evaluate original or permission-cleared novel/technical/footnote/table/illustrated fixtures. Record OCR omissions/order, line-end hyphens, names/terminology, translation quality and any authorized external-API comparison.
- [ ] Measure real OCR and translation latency, CPU, memory and Chrome's initial model download size per target platform/language pair.
- [ ] Review all shared Git history and rights for historical screenshots/test material. The screenshots still exist in earlier commits; this PR does not rewrite shared history. Decide how to prepare a clean public history before claiming that gate is satisfied.
- [ ] Complete third-party/model distribution review and current Kindle terms/copyright/technical-protection legal review. Local processing and an unofficial-project disclaimer do not establish permission. No legal approval is claimed here.
- [ ] Review the draft package and release gates before publishing a release or store listing.

Chrome's official Translator documentation lists desktop support, English and Korean, model download monitoring, user activation and the lack of Worker support: https://developer.chrome.com/docs/ai/translator-api (checked 2026-10-18). Actual extension/device support still requires the checks above.
