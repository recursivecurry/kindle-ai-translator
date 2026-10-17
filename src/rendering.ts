import {
  deadline,
  translationFont,
  typography,
  type Composition,
} from "./model";
import { loadTranslationFont } from "./fonts";

export async function createOverlay(
  output: Composition,
  width: number,
  height: number,
  source?: string,
): Promise<HTMLDivElement> {
  const appearance = typography(output.typography);
  await loadTranslationFont(appearance.family);
  const TRANSLATION_FONT = translationFont(appearance.family);
  const overlay = document.createElement("div");
  overlay.dataset.kwOverlay = "true";
  overlay.dataset.kwDiagnostics = JSON.stringify(output.diagnostics);
  overlay.dataset.kwCoordinates = JSON.stringify(
    output.coordinateSource ?? null,
  );
  overlay.setAttribute("aria-label", "번역문");
  overlay.lang = output.targetLanguage ?? "ko";
  const shadow = overlay.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{all:initial;overflow:hidden;pointer-events:none}*{box-sizing:border-box} [data-kw-sheet]{position:absolute;transform-origin:0 0}[data-kw-original]{display:none}:host([data-kw-show-original]) [data-kw-original]{display:block}:host([data-kw-show-original]) [data-kw-background],:host([data-kw-show-original]) p{display:none}img{position:absolute;inset:0;width:100%;height:100%;user-select:none;pointer-events:none}p{all:initial;position:absolute;pointer-events:auto;user-select:text;-webkit-user-select:text;cursor:text}span{all:initial;position:absolute;white-space:pre;user-select:text;-webkit-user-select:text;font-family:${TRANSLATION_FONT};font-weight:400;letter-spacing:normal;cursor:text}::selection{background:#9bc9ff;color:#111}`;
  const sheet = document.createElement("div");
  sheet.dataset.kwSheet = "true";
  sheet.style.width = `${width}px`;
  sheet.style.height = `${height}px`;
  const background = new Image();
  background.dataset.kwBackground = "true";
  background.alt = "";
  background.draggable = false;
  background.src = output.image;
  await deadline(
    background.decode(),
    10_000,
    "번역 배경을 읽는 시간이 초과되었습니다.",
  );
  sheet.append(background);
  if (source) {
    const original = new Image();
    original.dataset.kwOriginal = "true";
    original.alt = "이전 페이지 원문";
    original.draggable = false;
    original.src = source;
    await deadline(
      original.decode(),
      10_000,
      "이전 페이지 원문을 읽는 시간이 초과되었습니다.",
    );
    sheet.append(original);
  }
  for (const region of output.regions) {
    const paragraph = document.createElement("p");
    paragraph.dataset.kwParagraph = region.id;
    Object.assign(paragraph.style, {
      left: `${region.box.x0}px`,
      top: `${region.box.y0}px`,
      width: `${region.box.x1 - region.box.x0}px`,
      height: `${region.box.y1 - region.box.y0}px`,
    });
    for (const [index, run] of region.runs.entries()) {
      const line = document.createElement("span");
      line.textContent = run.text;
      Object.assign(line.style, {
        left: `${run.x - region.box.x0}px`,
        top: `${run.y - region.box.y0}px`,
        fontSize: `${run.fontSize}px`,
        lineHeight: `${run.fontSize}px`,
        color: run.color,
      });
      if (index) paragraph.append(document.createTextNode("\n"));
      paragraph.append(line);
    }
    sheet.append(paragraph);
  }
  shadow.append(style, sheet);
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "touchstart",
    "touchend",
  ])
    overlay.addEventListener(type, (event) => event.stopPropagation());
  return overlay;
}
