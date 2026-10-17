import { MODEL, type Paragraph, type PageContext } from "./model";

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
const MIN_PARALLEL_CHARACTERS = 400;

export function translationBatches(paragraphs: Paragraph[]) {
  const total = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
  if (paragraphs.length < 2 || total < MIN_PARALLEL_CHARACTERS)
    return [paragraphs];
  const sentenceBoundaries = new Set(
    paragraphs
      .slice(0, -1)
      .flatMap((p, i) =>
        /[.!?。！？]["'”’)]*\s*$/.test(p.text) ? [i + 1] : [],
      ),
  );
  let length = 0;
  let split = 1;
  let distance = Infinity;
  for (let index = 1; index < paragraphs.length; index++) {
    length += paragraphs[index - 1].text.length;
    if (sentenceBoundaries.size && !sentenceBoundaries.has(index)) continue;
    const candidate = Math.abs(total / 2 - length);
    if (candidate < distance) {
      distance = candidate;
      split = index;
    }
  }
  return [paragraphs.slice(0, split), paragraphs.slice(split)];
}

export function translationTextKey(
  book: string,
  source: string,
  target: string,
  paragraphs: Paragraph[],
  context: PageContext,
) {
  return JSON.stringify([
    "parallel-original-paragraphs-v2",
    MODEL,
    "low",
    book,
    source,
    target,
    context.map((p) => [normalized(p.source), normalized(p.translation)]),
    paragraphs.map((p) => [p.kind, normalized(p.text)]),
  ]);
}
