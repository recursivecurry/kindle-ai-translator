import type { Box, Paragraph } from "./model";

export const COORDINATE_EVENT = "kw-reader-coordinates";
export const COORDINATE_ATTRIBUTE = "data-kw-word-boxes";
const MAX_WORDS = 10000;
const MINIMUM_COVERAGE = 0.9;

export function validateWordBoxes(
  value: unknown,
  width: number,
  height: number,
): Box[] {
  if (!Array.isArray(value) || value.length > MAX_WORDS) return [];
  const valid = value.every(
    (box) =>
      box &&
      [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) &&
      box.x0 >= 0 &&
      box.y0 >= 0 &&
      box.x1 <= width &&
      box.y1 <= height &&
      box.x1 > box.x0 &&
      box.y1 > box.y0,
  );
  return valid ? value.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })) : [];
}

export function refineParagraphCoordinates(
  paragraphs: Paragraph[],
  boxes: Box[],
): number {
  let refined = 0;
  for (const paragraph of paragraphs) {
    const candidates = boxes.filter(
      (box) =>
        !paragraph.page ||
        (box.x0 >= paragraph.page.x0 && box.x1 <= paragraph.page.x1),
    );
    const matches = paragraph.words.map((word) => {
      const area = (word.x1 - word.x0) * (word.y1 - word.y0);
      return candidates.find(
        (box) =>
          (Math.max(0, Math.min(word.x1, box.x1) - Math.max(word.x0, box.x0)) *
            Math.max(
              0,
              Math.min(word.y1, box.y1) - Math.max(word.y0, box.y0),
            )) /
            area >=
            MINIMUM_COVERAGE &&
          box.x1 - box.x0 <= (word.x1 - word.x0) * 2 + 4 &&
          box.y1 - box.y0 <= (word.y1 - word.y0) * 2,
      );
    });
    if (!matches.some(Boolean)) continue;
    const words = paragraph.words.map((word, index) => {
      const match = matches[index];
      return match
        ? {
            x0: Math.min(word.x0, match.x0),
            x1: Math.max(word.x1, match.x1),
            y0: word.y0,
            y1: word.y1,
          }
        : word;
    });
    paragraph.lines = paragraph.lines.map((line) => {
      const inLine = words.filter(
        (word) => word.y0 >= line.y0 && word.y1 <= line.y1,
      );
      return inLine.length
        ? {
            ...line,
            x0: Math.min(...inLine.map((word) => word.x0)),
            x1: Math.max(...inLine.map((word) => word.x1)),
          }
        : line;
    });
    paragraph.words = words;
    paragraph.box = {
      ...paragraph.box,
      x0: Math.min(...words.map((word) => word.x0)),
      x1: Math.max(...words.map((word) => word.x1)),
    };
    refined++;
  }
  return refined;
}
