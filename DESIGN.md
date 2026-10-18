# Architecture

[한국어](DESIGN.ko.md)

`kindle-ai-translator` is a Chrome Manifest V3 extension. It recognizes text locally, translates it through the selected OpenAI or Chrome local engine, and overlays selectable text on the Kindle page. It has no separate application server.

## Components and flow

1. **Reader content script** detects visible page images and page changes, tracks Kindle Location, and manages the translation overlay and reader controls.
2. **Background service worker** manages settings, API credentials, cancellation, caches, and translation requests.
3. **Offscreen document** runs Tesseract OCR and Chrome local translation, measures translated text, and prepares a background that preserves illustrations.
4. **Kindle bridge** supplies native word coordinates when available. OCR coordinates remain the fallback.
5. **Settings page** manages the translation engine, languages, typography, cache size, and the API key. Saving enabled local translation prepares the model under user activation.

The processing flow is: ready page image → local OCR → translation → layout → display. Images stay local. When OpenAI is selected, it receives recognized paragraphs and relevant preceding-page context. Chrome local mode sends paragraphs to the extension's existing offscreen document and never calls OpenAI. The content script receives results without the API key.

## Performance and reading continuity

- **Page readiness:** Image decoding and stable Location, image, and layout observations trigger processing. A short timed fallback handles cases where readiness cannot be established.
- **Reusable OCR workers:** Two workers recognize the left and right pages concurrently when a spread is detected, preserving reading order.
- **OpenAI translation:** Longer text is split into two requests at paragraph boundaries, preferably after complete sentences. Paragraphs are neither merged nor subdivided. Translation uses `gpt-6-luna` with low reasoning effort.
- **Chrome local translation:** The settings page checks support and prepares the selected language pair. The offscreen document translates bounded chunks sequentially, reuses one translator per job, and destroys it on completion/cancellation. An unavailable or unprepared model fails without switching engines. Native-model output may contain omissions or mistranslations.
- **Separate caches:** OCR results, translated text, and rendered pages are cached independently. Compatible text results can be reused when layout changes. Engine selection participates in text cache keys and the settings revision so one engine's output cannot satisfy the other's request.
- **Location-based continuity:** Both translation context and previous-page view use recorded book order rather than visit order. Cached content appears promptly during navigation while the current page is processed. Active pages are protected from cache eviction.

## Layout and reliability

Translations use selectable HTML text over a reconstructed background. Native Kindle coordinates refine OCR positions where they match. Layout preserves page boundaries, paragraph positions, and illustrations as closely as possible; font size is estimated and adjusted to fit.

If recognition, background safety, or available space is insufficient, the original paragraph remains visible. Translation responses are checked for paragraph IDs, order, and completeness, but these checks cannot establish semantic accuracy.

Page changes and settings changes cancel obsolete work. Timeouts and result validation prevent stale translations from replacing the active view. API credentials stay in local extension storage; caches are temporary and held in memory.
