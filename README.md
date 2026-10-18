# kindle-ai-translator

[한국어](README.ko.md)

Translate books in Kindle Web Reader while keeping the original page layout as closely as possible. Translated text can be selected and copied.

## Experimental use and responsibility

This extension is a personal experiment. It is not affiliated with, endorsed by, or sponsored by Amazon or any book publisher or rights holder.

Use it only with content you are authorized to access and process, in accordance with applicable copyright law and the [Kindle Store Terms of Use](https://www.amazon.com/gp/help/customer/display.html?nodeId=201014950). Access to or purchase of a book does not by itself grant permission for every form of copying, translation, external API transmission, or redistribution. Do not use this extension to circumvent DRM or other access controls, or to copy, share, or publish content or translations without permission or another legal basis.

You are responsible for checking whether your use is permitted and for your own actions. The extension is provided as is, without warranties, to the extent permitted by law. This notice does not grant rights to any book or limit liability that cannot lawfully be excluded.

The extension reads rendered page images and uses Kindle's internal renderer for word coordinates. Local processing and this notice do not establish that a particular use complies with Amazon's terms. Review the [Amazon Conditions of Use](https://www.amazon.com/gp/help/customer/display.html?nodeId=GLSBYFE9MGKKQXXM), including the software terms, and any terms applicable to your region and book. This project does not guarantee legal compliance or protection from account restrictions.

For a rights concern, open a [GitHub issue](https://github.com/recursivecurry/kindle-ai-translator/issues) with the affected file or URL and the basis of your concern. Issues are public: do not attach book pages, API keys, or private account information.

## Example

The same spread from Lewis Carroll's *Alice's Adventures in Wonderland* in English and Korean, with the two-page layout preserved. The original English text is in the public domain.

The screenshots show the Kindle edition and this extension's generated translation, not a published Korean translation. [Project Gutenberg's record](https://www.gutenberg.org/ebooks/11) provides a reference for the original work's public-domain status in the US; it is not the source of these screenshots. Modern translations, additional illustrations, and the Kindle interface may have separate rights. The sample is not a claim that every edition or use is unrestricted.

### Original

![Original English text in Kindle Web Reader](docs/images/kindle-original.png)

### Translation

![Korean translation with the reader controls and previous-page view enabled](docs/images/kindle-translated.png)

## Install

You need Chrome 116 or later and a packaged extension ZIP. OpenAI translation requires an API key; optional Chrome local translation requires desktop Chrome 138 or later and a supported device/language pair. The repository's **Download ZIP** contains source code, not an installable extension.

1. Extract the extension ZIP to a folder you will keep on your computer.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the folder containing `manifest.json`.
3. Click the extension icon. Choose OpenAI API (the default) or Chrome local translation, choose the source and target languages, enable automatic translation, and save. Enter an API key for OpenAI. For local translation, saving prepares Chrome's model and shows download progress if needed.
4. Reload any open Kindle tabs and open a book.

Supported readers: `read.amazon.com`, `read.amazon.co.uk`, `read.amazon.co.jp`, and `read.amazon.de`.

## Read and translate

Use the menu at the bottom right of the reader to:

- Switch between the original and translation.
- Retry a translation or turn translation off and back on.
- Change the source and target languages.
- Toggle **Previous page view**.

Press **Alt+Shift+T** (**Option+Shift+T** on Mac) to switch between the original and translation. Select translated text by dragging; use Kindle's arrows or the page margins to turn pages.

### Previous page view

This mode shows the preceding page in book order while translating the current Kindle page in the background. For example, when Kindle moves to page 3, you read page 2. Moving back to page 2 shows page 1, if it is cached.

The existing view stays visible during page changes until the replacement is ready. A cached original may appear before its translation. If the preceding page cannot be identified or is no longer cached, the current page is shown instead.

Kindle's Location and progress indicator still refer to its current page. The original/translation toggle applies to the page you are viewing. This mode does not turn pages automatically or pretranslate unread pages.

## Settings

Open settings from the extension icon. Settings apply across Kindle tabs.

| Setting                     | Choices                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Translation engine         | OpenAI API (default) or Chrome local Translator API. Changing engines preserves the stored API key and clears incompatible translation results. |
| Source and target languages | English, Korean, Japanese, Simplified Chinese, Traditional Chinese, Spanish, French, German, Portuguese, Vietnamese. Default: English → Korean. |
| Font                        | Nanum Gothic or Nanum Myeongjo; other characters use system fallback fonts.                                                                     |
| Text size                   | 70–130% of the estimated original size.                                                                                                         |
| Cache size                  | 1–30 page images; default 5. A two-page spread stored as one image counts as one entry.                                                         |

Page images, OCR results, and translations are cached in memory, not saved as book files or synced by the extension. Image caches use a 24 MB budget and check a 10-minute expiry when accessed; images needed for the active previous-page view are exempt from eviction while protected. This is not a promise that all data is erased after 10 minutes. Closing the reader tab releases its viewer cache. Memory limits may reduce the number of retained pages.

## Privacy and cost

Text recognition runs on your device. With OpenAI selected, recognized text and relevant preceding-page text and translations are sent to OpenAI. Book images are not sent to OpenAI. With Chrome local translation selected, text is translated on your device in the existing OCR/composition pipeline. Chrome may download translation models; local translation does not call OpenAI or automatically fall back to it.

Your API key stays in this browser's local extension storage and is not synced. It is accessible to someone with access to your device. OpenAI API usage is billed separately from a ChatGPT subscription; new translations and retries may incur charges. Chrome local translation needs no key or API usage fee. Both modes retain the existing temporary page caches and previous-page view.

Automatic translation is off on a new installation. Enabling it applies the selected engine across Kindle tabs, including pages you subsequently open. With OpenAI selected, the API key authenticates requests directly to OpenAI; it is not sent to the Kindle page. Check that external processing of the content is permitted before enabling it. Turn translation off in the reader or settings to stop automatic translation. Choosing a local engine reduces external disclosure; it does not grant permission to translate or copy content.

OpenAI requests use `store: false` to disable response storage. This does not mean zero retention: abuse-monitoring logs may contain input and output and are normally retained for up to 30 days, with exceptions for legal obligations or safety needs. Account-specific controls may differ. See [OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data). This extension has no developer-operated content server or analytics endpoint; Amazon's own handling of Kindle activity is governed separately by its policies.

## Third-party licenses

The extension bundles Tesseract.js, the OCR core, ten language datasets, and Nanum Gothic/Myeongjo fonts. Their licenses and notices are listed in [THIRD_PARTY_NOTICES.txt](https://github.com/recursivecurry/kindle-ai-translator/blob/main/public/THIRD_PARTY_NOTICES.txt). The installation ZIP includes the notice at its root, JavaScript dependency licenses in `licenses/`, OCR licenses in `vendor/` and `TESSDATA-LICENSE.txt`, and font licenses in `fonts/`. Preserve these notices when redistributing the included components.

Third-party software licenses do not grant rights to books, Amazon's interface or trademarks, or external translation services.

## Limitations and troubleshooting

- Recognition and translation can contain errors. Use the original view to check unclear passages.
- Layout and font size are approximations. Paragraphs that cannot fit or safely cover the original remain untranslated.
- Tables, equations, vertical writing, and text over pictures may not work well.
- If OpenAI translation fails, check the API key and account balance or limits, then use **Retry**.
- For Chrome local translation, open settings, enable automatic translation and save to prepare the selected language pair. Repeat this after changing to an unprepared language pair in the reader. Unsupported devices/languages and failed model preparation show an error; they do not switch to OpenAI. The local model can mistranslate or omit content, so compare it with the original.
- After installing or reloading the extension, reload the Kindle tab too.
