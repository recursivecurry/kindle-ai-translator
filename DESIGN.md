# Design

A toolbar click grants `activeTab` and opens an extension side panel. A second explicit click in that panel creates a Chrome Translator instance under user activation, including feature detection, language-pair availability and model download progress.

The panel injects an isolated-world observer into the supported Kindle tab. The observer reports only visible `.kg-full-page-img img` rectangles, viewport size and a local revision. It detects image, layout and visibility changes without reading book text or internal renderer objects. Unsupported embedded layouts fail closed.

The panel captures the visible tab with `captureVisibleTab`, copies reader rectangles to a white canvas, and runs the existing packaged Tesseract OCR. It translates paragraphs sequentially in bounded chunks using one Translator per operation. The panel displays text with `textContent`, leaving the reader intact.

Page changes, tab changes, navigation, cancellation and panel closure invalidate the operation and displayed result. Each operation owns its AbortController, OCR worker, Translator and canvas. Resources are released after completion, including late initialization after cancellation. There is no previous-page mode or content cache.

The background worker configures toolbar-to-panel behavior and deletes legacy API settings on upgrade. No content enters the background worker. The build includes only background, observer and panel entry points plus packaged OCR assets. The extension CSP permits connections only to its own packaged resources; browser-managed translation model downloads are separate.
