# kindle-ai-translator

[한국어](README.ko.md)

Translate the currently visible Kindle Web Reader page with packaged Tesseract OCR and Chrome's on-device Translator API. Start each translation yourself; the extension does not turn pages or collect a book. Results appear in a side panel beside the original reader.

## Install and use

Use desktop Chrome 138 or later. Translator availability depends on the device, browser policy and language pair; English → Korean is the default. Mobile browsers are unsupported. No API key or account is needed.

1. Run `npm ci` and `npm run build`, or extract a packaged extension ZIP. GitHub's source ZIP must be built first.
2. Open `chrome://extensions`, enable Developer mode, select Load unpacked, and choose `dist` (or the extracted folder containing `manifest.json`).
3. Open a book at `read.amazon.com`, `read.amazon.co.uk`, `read.amazon.co.jp` or `read.amazon.de`. Click the extension toolbar icon to grant access to that tab and open the side panel.
4. Choose source and target languages, then click the current-page translation button. Chrome may download a translation model on first use; progress appears in the panel.
5. Read and select the translation in the panel. Cancel clears it. Turning pages, resizing, switching tabs or closing the panel clears the result and cancels pending work. Start the next translation with another click.

If the model download fails, retry with a network connection. If Chrome's Translator API or language pair is unavailable, the panel reports it without sending text to a server. If capture is denied, click the extension icon on the Kindle tab again. A missing or unsupported reader layout fails without extracting internal book data.

## Local processing and permissions

The extension captures the active tab's visible screen through `captureVisibleTab`, then crops it to visible Kindle page image rectangles before OCR. Capture briefly includes the visible tab; only the cropped reader regions enter OCR. It does not fetch Kindle image URLs or access Kindle's internal renderer, network responses or book files.

Images, recognized text and translations remain in memory for the current operation/view. There is no content cache, telemetry, external translation service or automatic fallback. OCR scripts, WebAssembly and language data ship in the extension. Chrome manages translation model downloads and its own model cache. See [PRIVACY.md](PRIVACY.md).

Permissions are `activeTab` and `scripting` for explicitly granted tab capture and page bounds, `sidePanel` for the UI, and `storage` solely to delete legacy API credentials/settings when upgrading. There are no persistent host permissions or automatically injected content scripts. Language choices last only while the panel remains open.

## Development and validation

```sh
npm ci
npm run check
npm test
npm run package
npx playwright install chromium
npm run test:integration
```

Browser integration uses original synthetic text, packaged OCR and a mock Translator API. It validates the panel pipeline, failure/retry, cancellation and network isolation; it does not prove real Chrome model quality or toolbar-granted capture behavior. See [docs/VALIDATION.md](docs/VALIDATION.md) for the remaining device and release checks. CI prepares draft releases for manual review.

## Limitations and project status

OCR may omit text, misorder columns, preserve line-end hyphens or misread footnotes, tables, equations and text over illustrations. Long paragraphs are split into bounded requests, which can reduce translation context. Embedded reader frames and changed Kindle layouts may be unsupported. Translation quality and latency on real target devices remain unverified.

This is an unofficial personal reading aid, unaffiliated with Amazon or Kindle. Amazon and Kindle are their owners' trademarks. Local processing does not establish permission to copy or translate a book. Follow applicable copyright law and service terms; a disclaimer does not guarantee permission. Legal review remains a release gate.

Source code is available under [MIT](LICENSE). OCR and language data retain their licenses in `public/THIRD_PARTY_NOTICES.txt` and the packaged `vendor` directory. Chrome supplies and manages the translation models; they are not redistributed by this repository. Existing shared Git history contains earlier screenshots and external-API code; this change removes those from the current tree and distribution without rewriting shared history.
