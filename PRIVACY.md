# Privacy

The extension processes only a user-requested capture of the currently visible Kindle reader. Chrome's capture API initially returns the visible tab screenshot; the extension crops it to visible reader page rectangles before local OCR. It never retrieves underlying book files or automatically turns pages.

OCR runs in a packaged Tesseract worker in the extension side panel. Recognized paragraphs go to Chrome's on-device Translator API. Book images, OCR text, translations and book metadata are not sent to an extension server or translation API. There is no telemetry or remote error reporting. The extension page CSP restricts fetches to packaged resources.

Chrome may download translation models through browser-managed network requests. These are distinct from book-content processing. OCR worker code, WebAssembly and language models are bundled, with Tesseract's IndexedDB model cache disabled. Chrome's own translation model storage is managed by Chrome.

The current capture, paragraphs and translations are held in memory. Intermediate canvases and OCR/translation workers are released after completion or cancellation. The result remains visible until a page or tab change, cancellation, language change or panel closure. There is no multi-page content cache, export, localStorage, IndexedDB or extension-storage write of book content. No book content is logged. The observer used for page-change detection temporarily compares image identifiers and bounds inside the reader; identifiers are not sent to the panel.

The storage permission is retained only to remove legacy API keys and settings on install/update. The new version writes no settings or credentials. This policy describes the current version, not older versions that sent recognized text to OpenAI.

A user with access to the device or debugging tools may inspect in-memory content. Browser-managed diagnostics and Kindle's own network traffic are outside this extension's control. Real-device network validation remains listed in docs/VALIDATION.md.
