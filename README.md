# kindle-ai-translator

[한국어](README.ko.md)

Translate books in Kindle Web Reader while keeping the original page layout as closely as possible. Translated text can be selected and copied.

## Example

The same Kindle spread in English and Korean, with illustrations and the two-page layout preserved.

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

The cache is temporary. Memory and expiry limits may reduce the number of retained pages; pages needed for the active previous-page view receive priority.

## Privacy and cost

Text recognition runs on your device. With OpenAI selected, recognized text and relevant preceding-page text and translations are sent to OpenAI. Book images are not sent to OpenAI. With Chrome local translation selected, text is translated on your device in the existing OCR/composition pipeline. Chrome may download translation models; local translation does not call OpenAI or automatically fall back to it.

Your API key stays in this browser's local extension storage and is not synced. It is accessible to someone with access to your device. OpenAI API usage is billed separately from a ChatGPT subscription; new translations and retries may incur charges. Chrome local translation needs no key or API usage fee. Both modes retain the existing temporary page caches and previous-page view.

## Limitations and troubleshooting

- Recognition and translation can contain errors. Use the original view to check unclear passages.
- Layout and font size are approximations. Paragraphs that cannot fit or safely cover the original remain untranslated.
- Tables, equations, vertical writing, and text over pictures may not work well.
- If OpenAI translation fails, check the API key and account balance or limits, then use **Retry**.
- For Chrome local translation, open settings, enable automatic translation and save to prepare the selected language pair. Repeat this after changing to an unprepared language pair in the reader. Unsupported devices/languages and failed model preparation show an error; they do not switch to OpenAI. The local model can mistranslate or omit content, so compare it with the original.
- After installing or reloading the extension, reload the Kindle tab too.
