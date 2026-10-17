import { COORDINATE_ATTRIBUTE, COORDINATE_EVENT } from "./kindle-coordinates";

type Token = {
  x: number;
  y: number;
  width: number;
  height: number;
  pieces?: { left: number; top: number; right: number; bottom: number }[];
};
type RenderedPage = { tokens?: { children?: { words?: Token[] }[] } };
type View = {
  getRoot(): HTMLElement;
  getScale(): number;
  getRenderedPage(): RenderedPage;
};
type Runtime = ((id: number) => { ContentView?: { prototype: View } }) & {
  m?: Record<number, unknown>;
};
const RENDERER_MODULE = 65932;
const views = new Set<View>();
let installed = false;

function remember(view: View) {
  views.add(view);
  for (const item of views) if (!item.getRoot().isConnected) views.delete(item);
  while (views.size > 8) views.delete(views.values().next().value!);
}
function install(runtime: Runtime) {
  if (installed || !runtime.m?.[RENDERER_MODULE]) return;
  const prototype = runtime(RENDERER_MODULE).ContentView?.prototype;
  if (
    !prototype ||
    typeof prototype.getRenderedPage !== "function" ||
    typeof prototype.getRoot !== "function"
  )
    return;
  const getPage = prototype.getRenderedPage;
  prototype.getRenderedPage = function () {
    const page = getPage.call(this);
    try {
      remember(this);
    } catch {
      document.documentElement?.setAttribute(
        "data-kw-coordinate-bridge",
        "unsupported",
      );
    }
    return page;
  };
  installed = true;
}
const timer = setInterval(() => {
  const chunks = (
    window as unknown as {
      webpackChunk_amzn_kryptonite_reader_web_app_assets?: unknown[];
    }
  ).webpackChunk_amzn_kryptonite_reader_web_app_assets;
  if (!chunks || chunks.push === Array.prototype.push) return;
  try {
    chunks.push([[`kw-coordinates-${Date.now()}`], {}, install]);
    if (installed) clearInterval(timer);
  } catch {
    document.documentElement?.setAttribute(
      "data-kw-coordinate-bridge",
      "unsupported",
    );
    clearInterval(timer);
  }
}, 250);
setTimeout(() => clearInterval(timer), 60000);

document.addEventListener(COORDINATE_EVENT, (event) => {
  const image = event.target;
  if (
    !(image instanceof HTMLImageElement) ||
    !image.closest(".kg-full-page-img")
  )
    return;
  image.removeAttribute(COORDINATE_ATTRIBUTE);
  try {
    const view = [...views].find((item) => item.getRoot().contains(image));
    if (!view) return;
    const rect = image.getBoundingClientRect();
    const root = view.getRoot().getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = view.getScale();
    const words =
      view
        .getRenderedPage()
        .tokens?.children?.flatMap((child) => child.words ?? []) ?? [];
    if (words.length > 10000) return;
    const boxes = words
      .flatMap((word) =>
        word.pieces?.length
          ? word.pieces
          : [
              {
                left: word.x,
                top: word.y,
                right: word.x + word.width,
                bottom: word.y + word.height,
              },
            ],
      )
      .map((box) => ({
        x0:
          ((box.left * scale + root.left - rect.left) * image.naturalWidth) /
          rect.width,
        y0:
          ((box.top * scale + root.top - rect.top) * image.naturalHeight) /
          rect.height,
        x1:
          ((box.right * scale + root.left - rect.left) * image.naturalWidth) /
          rect.width,
        y1:
          ((box.bottom * scale + root.top - rect.top) * image.naturalHeight) /
          rect.height,
      }));
    image.setAttribute(
      COORDINATE_ATTRIBUTE,
      JSON.stringify(
        boxes.filter(
          (box) =>
            [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) &&
            box.x0 >= 0 &&
            box.y0 >= 0 &&
            box.x1 <= image.naturalWidth &&
            box.y1 <= image.naturalHeight &&
            box.x1 > box.x0 &&
            box.y1 > box.y0,
        ),
      ),
    );
    document.documentElement.setAttribute("data-kw-coordinate-bridge", "ready");
  } catch {
    document.documentElement.setAttribute(
      "data-kw-coordinate-bridge",
      "unsupported",
    );
  }
});
