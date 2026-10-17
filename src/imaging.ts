import { TARGET_LANGUAGES, sourceLanguage } from "./languages";
import { createWorker, type Worker } from "tesseract.js";
import {
  deadline,
  OCR_TIMEOUT,
  wrapText,
  type Paragraph,
  type Translation,
  type Box,
  type Composition,
  type TextRegion,
  typography,
  translationFont,
  type Typography,
} from "./model";
import { pageRegions } from "./layout";
const WORD_EDGE_PADDING_RATIO = 0.12;
const MINIMUM_WORD_EDGE_PADDING = 2;
const MAX_GLYPH_COMPONENT_RATIO = 1.5;
export async function decode(data: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
  });
  image.src = data;
  await deadline(loaded, 10_000, "이미지 로딩 시간이 초과되었습니다.");
  if (
    !image.naturalWidth ||
    image.naturalWidth * image.naturalHeight > 16_000_000
  )
    throw new Error("이미지 크기를 지원하지 않습니다.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true })!.drawImage(image, 0, 0);
  return canvas;
}
export function createOcrWorker(language: unknown) {
  return createWorker(TARGET_LANGUAGES[sourceLanguage(language)].ocr, 1, {
    workerPath: chrome.runtime.getURL("vendor/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/core"),
    langPath: chrome.runtime.getURL("vendor"),
    workerBlobURL: false,
    logger: () => {},
    errorHandler: () => {},
  });
}
export async function recognize(
  canvas: HTMLCanvasElement,
  setWorker: (worker: Worker) => void,
  language: unknown = "en",
  checkCancelled: () => void = () => {},
  timings: Record<string, number> = {},
  preparedWorker?: Promise<Worker> | Promise<Worker>[],
): Promise<Paragraph[]> {
  const workerStart = performance.now();
  const prepared = preparedWorker ?? createOcrWorker(language);
  const workers = await Promise.all(
    (Array.isArray(prepared) ? prepared : [prepared]).map(async (pending) => {
      const worker = await pending;
      setWorker(worker);
      checkCancelled();
      return worker;
    }),
  );
  timings.workerInitMs = Math.round(performance.now() - workerStart);
  const recognitionStart = performance.now();
  checkCancelled();
  const pixels = canvas
    .getContext("2d")!
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const regions = pageRegions(canvas.width, canvas.height, pixels);
  const recognizeRegion = async (region: Box, worker: Worker) => {
    const paragraphs: Paragraph[] = [];
    const crop = document.createElement("canvas");
    crop.width = region.x1 - region.x0;
    crop.height = region.y1 - region.y0;
    crop
      .getContext("2d")!
      .drawImage(
        canvas,
        region.x0,
        region.y0,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
    const blob = await new Promise<Blob>((resolve, reject) => {
      crop.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("이미지를 읽을 수 없습니다."));
      });
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    checkCancelled();
    const { data } = await deadline(
      worker.recognize(bytes, {}, { blocks: true, text: true }),
      OCR_TIMEOUT,
      "OCR 시간이 초과되었습니다.",
    );
    checkCancelled();
    const offset = (box: Box): Box => ({
      x0: box.x0 + region.x0,
      x1: box.x1 + region.x0,
      y0: box.y0 + region.y0,
      y1: box.y1 + region.y0,
    });
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs)
        for (const line of paragraph.lines) {
          line.bbox = offset(line.bbox);
          for (const word of line.words) word.bbox = offset(word.bbox);
        }
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs) {
        let current: Paragraph | undefined;
        let previousHeight = 0;
        for (const line of paragraph.lines) {
          if (!line.text.trim()) continue;
          const height = line.bbox.y1 - line.bbox.y0;
          if (
            !current ||
            line.bbox.x0 - current.box.x0 > height * 0.8 ||
            line.bbox.y0 - current.box.y1 > previousHeight * 1.2 ||
            Math.max(height, previousHeight) /
              Math.min(height, previousHeight) >
              1.3
          ) {
            current = {
              id: `p${paragraphs.length}`,
              text: line.text.trim(),
              box: { ...line.bbox },
              words: [],
              lines: [],
              confidence: paragraph.confidence,
              kind: "body",
              page: region,
            };
            paragraphs.push(current);
          } else {
            current.text += "\n" + line.text.trim();
            current.box = {
              x0: Math.min(current.box.x0, line.bbox.x0),
              y0: current.box.y0,
              x1: Math.max(current.box.x1, line.bbox.x1),
              y1: line.bbox.y1,
            };
          }
          current.words.push(...line.words.map((word) => word.bbox));
          current.lines.push({ ...line.bbox });
          previousHeight = height;
        }
      }
    return paragraphs;
  };
  const regionParagraphs: Paragraph[][] = new Array(regions.length);
  await Promise.all(
    workers.map(async (worker, workerIndex) => {
      for (
        let index = workerIndex;
        index < regions.length;
        index += workers.length
      ) {
        checkCancelled();
        const started = performance.now();
        regionParagraphs[index] = await recognizeRegion(regions[index], worker);
        timings[`region${index}Ms`] = Math.round(performance.now() - started);
      }
    }),
  );
  const paragraphs = regionParagraphs.flat();
  paragraphs.forEach((paragraph, index) => {
    paragraph.id = `p${index}`;
  });
  timings.workerCount = Math.min(workers.length, regions.length);
  timings.regionCount = regions.length;
  if (!paragraphs.length) throw new Error("영어 본문을 인식하지 못했습니다.");
  const heights = paragraphs
    .map((p) => (p.box.y1 - p.box.y0) / Math.max(1, p.text.split("\n").length))
    .sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  for (const p of paragraphs) {
    const h = (p.box.y1 - p.box.y0) / Math.max(1, p.text.split("\n").length);
    p.kind =
      h > median * 1.3 ? "heading" : h < median * 0.8 ? "caption" : "body";
  }
  timings.recognitionMs = Math.round(performance.now() - recognitionStart);
  return paragraphs;
}
function backgroundColor(
  context: CanvasRenderingContext2D,
  box: Box,
  words: Box[],
): {
  color: number[] | null;
  issue?: string;
  pixel?: { x: number; y: number };
} {
  const x = Math.max(0, Math.floor(box.x0) - 2),
    y = Math.max(0, Math.floor(box.y0) - 2);
  const width = Math.min(context.canvas.width, Math.ceil(box.x1) + 3) - x,
    height = Math.min(context.canvas.height, Math.ceil(box.y1) + 3) - y;
  if (width <= 0 || height <= 0) return { color: null, issue: "bounds" };
  const pixels = context.getImageData(x, y, width, height).data;
  const bins = new Map<string, { count: number; color: number[] }>();
  for (let i = 0; i < pixels.length; i += 4) {
    const color = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = color.map((c) => Math.round(c / 16)).join(",");
    const bin = bins.get(key);
    if (bin) bin.count++;
    else bins.set(key, { count: 1, color });
  }
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant || dominant.count / (width * height) < 0.5)
    return { color: null, issue: "nonuniform" };
  const wordHeights = words
    .map((word) => word.y1 - word.y0)
    .sort((a, b) => a - b);
  const wordPadding = Math.max(
    MINIMUM_WORD_EDGE_PADDING,
    Math.ceil(
      (wordHeights[Math.floor(wordHeights.length / 2)] ?? 0) *
        WORD_EDGE_PADDING_RATIO,
    ),
  );
  const isInk = (index: number) =>
    dominant.color.some((c, k) => Math.abs(c - pixels[index * 4 + k]) > 30);
  const insideWord = (col: number, row: number) =>
    words.some(
      (word) =>
        x + col >= word.x0 - wordPadding &&
        x + col <= word.x1 + wordPadding &&
        y + row >= word.y0 - wordPadding &&
        y + row <= word.y1 + wordPadding,
    );
  const recoveredInk = new Set<number>();
  const isConnectedGlyph = (col: number, row: number) => {
    const start = row * width + col;
    if (recoveredInk.has(start)) return true;
    const component = new Set<number>([start]);
    const queue = [start];
    let left = col,
      right = col,
      top = row,
      bottom = row,
      touchesWord = false;
    const maximum =
      (wordHeights[Math.floor(wordHeights.length / 2)] ?? 0) *
      MAX_GLYPH_COMPONENT_RATIO;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor],
        cx = index % width,
        cy = Math.floor(index / width);
      left = Math.min(left, cx);
      right = Math.max(right, cx);
      top = Math.min(top, cy);
      bottom = Math.max(bottom, cy);
      if (right - left > maximum || bottom - top > maximum) return false;
      touchesWord ||= insideWord(cx, cy);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx,
            ny = cy + dy,
            next = ny * width + nx;
          if (
            nx >= 0 &&
            nx < width &&
            ny >= 0 &&
            ny < height &&
            !component.has(next) &&
            isInk(next)
          ) {
            component.add(next);
            queue.push(next);
          }
        }
    }
    if (touchesWord) for (const index of component) recoveredInk.add(index);
    return touchesWord;
  };
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4;
      if (isInk(i / 4) && !insideWord(col, row) && !isConnectedGlyph(col, row))
        return {
          color: null,
          issue: "outside-word",
          pixel: { x: x + col, y: y + row },
        };
    }
  let border = 0,
    matching = 0;
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++)
      if (row < 2 || col < 2 || row >= height - 2 || col >= width - 2) {
        border++;
        const i = (row * width + col) * 4;
        if (dominant.color.every((c, k) => Math.abs(c - pixels[i + k]) < 25))
          matching++;
      }
  return matching / border > 0.94
    ? { color: dominant.color }
    : { color: null, issue: "border" };
}
export function compose(
  canvas: HTMLCanvasElement,
  paragraphs: Paragraph[],
  translations: Translation[],
  appearance: Typography = typography(),
): Composition {
  const font = translationFont(appearance.family);
  const context = canvas.getContext("2d")!;
  const skipped: string[] = [];
  const regions: TextRegion[] = [];
  const diagnostics: Composition["diagnostics"] = [];
  for (const [index, p] of paragraphs.entries()) {
    let box = p.box,
      width = box.x1 - box.x0,
      height = box.y1 - box.y0;
    const background = backgroundColor(context, box, p.words);
    const { color } = background;
    if (
      !color ||
      p.confidence < 55 ||
      (p.page && (box.x0 < p.page.x0 || box.x1 > p.page.x1))
    ) {
      skipped.push(p.id);
      diagnostics.push({
        id: p.id,
        reason: !color
          ? `background:${background.issue}:${JSON.stringify(background.pixel ?? null)}`
          : p.confidence < 55
            ? "confidence"
            : "page-boundary",
        box,
        confidence: p.confidence,
      });
      continue;
    }
    if (p.lines.length === 1 && p.page) {
      const page = p.page;
      const samePage = paragraphs.filter(
        (other) => other.page?.x0 === page.x0 && other.page?.x1 === page.x1,
      );
      const expanded = {
        ...box,
        x1: Math.min(
          page.x1,
          Math.max(...samePage.map((other) => other.box.x1)),
        ),
      };
      const overlaps = samePage.some(
        (other) =>
          other !== p &&
          other.box.y0 < expanded.y1 &&
          other.box.y1 > expanded.y0 &&
          other.box.x0 < expanded.x1 &&
          other.box.x1 > expanded.x0,
      );
      if (
        expanded.x1 > box.x1 &&
        !overlaps &&
        backgroundColor(context, expanded, p.words).color
      ) {
        box = expanded;
        width = box.x1 - box.x0;
        height = box.y1 - box.y0;
      }
    }
    const sourceLines = p.lines;
    const glyphHeights = sourceLines
      .map((line) => line.y1 - line.y0)
      .sort((a, b) => a - b);
    const originalHeight = glyphHeights[Math.floor(glyphHeights.length / 2)];
    const sourceStep =
      sourceLines.length > 1
        ? (sourceLines.at(-1)!.y0 - sourceLines[0].y0) /
          (sourceLines.length - 1)
        : originalHeight;
    const centered =
      sourceLines.length > 1 &&
      sourceLines.some(
        (line) => box.x1 - box.x0 - (line.x1 - line.x0) > originalHeight,
      ) &&
      sourceLines.every(
        (line) =>
          Math.abs((line.x0 + line.x1) / 2 - (box.x0 + box.x1) / 2) <
          originalHeight * 0.4,
      );
    const indent =
      !centered && sourceLines.length > 1
        ? Math.max(0, sourceLines[0].x0 - box.x0)
        : 0;
    context.font = `100px ${font}`;
    const sample = context.measureText("한글Ag");
    const preferredSize =
      (originalHeight * 100) /
      (sample.actualBoundingBoxAscent + sample.actualBoundingBoxDescent);
    const requestedSize = preferredSize * appearance.scale;
    const minimum = Math.max(1, Math.floor(requestedSize * 0.85));
    let size = Math.floor(requestedSize);
    let lineStep = sourceStep;
    let lines: string[] = [];
    for (; size >= minimum; size--) {
      context.font = `${size}px ${font}`;
      lines = wrapText(
        translations[index].text,
        width,
        (t) => context.measureText(t).width,
        width - indent,
      );
      lineStep = (sourceStep * size) / preferredSize;
      if (
        lines.every((line, i) => {
          const metrics = context.measureText(line);
          return (
            i * lineStep +
              metrics.actualBoundingBoxAscent +
              metrics.actualBoundingBoxDescent <=
            height
          );
        })
      )
        break;
    }
    if (
      size < minimum ||
      lines.some((line, i) => {
        const metrics = context.measureText(line);
        return (
          metrics.width > width - (i === 0 ? indent : 0) ||
          i * lineStep +
            metrics.actualBoundingBoxAscent +
            metrics.actualBoundingBoxDescent >
            height
        );
      })
    ) {
      skipped.push(p.id);
      diagnostics.push({
        id: p.id,
        reason: "space",
        box,
        confidence: p.confidence,
        fontSize: size,
        lineCount: lines.length,
        lineStep,
        inkHeight: Math.max(
          ...lines.map((line) => {
            const m = context.measureText(line);
            return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
          }),
        ),
      });
      continue;
    }
    context.fillStyle = `rgb(${color.join(",")})`;
    context.fillRect(box.x0 - 1, box.y0 - 1, width + 2, height + 2);
    const foreground =
      color.reduce((a, b) => a + b, 0) > 384 ? "#181818" : "#f5f5f5";
    regions.push({
      id: p.id,
      box,
      runs: lines.map((line, i) => {
        const metrics = context.measureText(line);
        const baseline =
          metrics.fontBoundingBoxAscent +
          (size -
            metrics.fontBoundingBoxAscent -
            metrics.fontBoundingBoxDescent) /
            2;
        return {
          text: line,
          x: centered
            ? box.x0 + (width - metrics.width) / 2
            : box.x0 + (i === 0 ? indent : 0),
          y: box.y0 + i * lineStep + metrics.actualBoundingBoxAscent - baseline,
          fontSize: size,
          color: foreground,
        };
      }),
    });
  }
  return {
    typography: appearance,
    image: canvas.toDataURL("image/png"),
    skipped,
    regions,
    diagnostics,
  };
}
