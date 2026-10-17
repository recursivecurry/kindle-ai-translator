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

You need Chrome 116 or later, an OpenAI API key, and a packaged extension ZIP. The repository's **Download ZIP** contains source code, not an installable extension.

1. Extract the extension ZIP to a folder you will keep on your computer.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the folder containing `manifest.json`.
3. Click the extension icon. Enter your API key, choose the source and target languages, enable automatic translation, and save.
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
| Source and target languages | English, Korean, Japanese, Simplified Chinese, Traditional Chinese, Spanish, French, German, Portuguese, Vietnamese. Default: English → Korean. |
| Font                        | Nanum Gothic or Nanum Myeongjo; other characters use system fallback fonts.                                                                     |
| Text size                   | 70–130% of the estimated original size.                                                                                                         |
| Cache size                  | 1–30 page images; default 5. A two-page spread stored as one image counts as one entry.                                                         |

The cache is temporary. Memory and expiry limits may reduce the number of retained pages; pages needed for the active previous-page view receive priority.

## Privacy and cost

Text recognition runs on your device. Recognized text and relevant preceding-page text and translations are sent to OpenAI. Book images are not sent to OpenAI.

Your API key stays in this browser's local extension storage and is not synced. It is accessible to someone with access to your device. API usage is billed separately from a ChatGPT subscription; new translations and retries may incur charges.

## Limitations and troubleshooting

- Recognition and translation can contain errors. Use the original view to check unclear passages.
- Layout and font size are approximations. Paragraphs that cannot fit or safely cover the original remain untranslated.
- Tables, equations, vertical writing, and text over pictures may not work well.
- If translation fails, check the API key and account balance or limits, then use **Retry**.
- After installing or reloading the extension, reload the Kindle tab too.
