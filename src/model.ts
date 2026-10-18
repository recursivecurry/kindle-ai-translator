export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Paragraph = {
  id: string;
  text: string;
  box: Box;
  words: Box[];
  lines: Box[];
  confidence: number;
  kind: "heading" | "body" | "caption";
  page?: Box;
};
export const TRANSLATION_FONT = '"KW Nanum Gothic", sans-serif';
export const PAGE_CACHE_TTL = 10 * 60_000;
export const DEFAULT_CACHE_PAGES = 5;
export const MAX_CACHE_PAGES = 30;
export function cachePageLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_CACHE_PAGES, Math.floor(value)))
    : DEFAULT_CACHE_PAGES;
}
export type Typography = { family: "serif" | "sans-serif"; scale: number };
export function typography(input?: unknown): Typography {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : undefined;
  return {
    family: value?.family === "serif" ? "serif" : "sans-serif",
    scale:
      typeof value?.scale === "number" && Number.isFinite(value.scale)
        ? Math.max(0.7, Math.min(1.3, value.scale))
        : 1,
  };
}
export function translationFont(family: Typography["family"]): string {
  return family === "serif" ? '"KW Nanum Myeongjo", serif' : TRANSLATION_FONT;
}
export type TextRun = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
};
export type TextRegion = { id: string; box: Box; runs: TextRun[] };
export type Composition = {
  targetLanguage?: string;
  coordinateSource?: {
    nativeWords: number;
    refinedParagraphs: number;
    ocrParagraphs: number;
  };
  typography?: Typography;
  image: string;
  skipped: string[];
  regions: TextRegion[];
  diagnostics: {
    id: string;
    reason: string;
    box: Box;
    confidence: number;
    fontSize?: number;
    lineCount?: number;
    lineStep?: number;
    inkHeight?: number;
  }[];
};
export type Translation = { id: string; text: string };
export type PageContext = { source: string; translation: string }[];
export const MODEL = "gpt-6-luna";
export const CONTEXT_CHARACTERS = 8000;
export function boundedContext(value: unknown): PageContext {
  if (!Array.isArray(value)) return [];
  const result: PageContext = [];
  let remaining = CONTEXT_CHARACTERS;
  for (const row of value.slice(-100).reverse()) {
    if (typeof row?.source !== "string" || typeof row?.translation !== "string")
      return [];
    const length = row.source.length + row.translation.length;
    if (length > remaining) break;
    result.unshift({ source: row.source, translation: row.translation });
    remaining -= length;
  }
  return result;
}
export const JOB_TIMEOUT = 120_000;
export const OCR_TIMEOUT = 60_000;
export function validateTranslations(
  value: unknown,
  paragraphs: Paragraph[],
): Translation[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("paragraphs" in value) ||
    !Array.isArray(value.paragraphs)
  )
    throw new Error("번역 응답 형식이 올바르지 않습니다.");
  const rows: unknown[] = value.paragraphs;
  if (rows.length !== paragraphs.length)
    throw new Error("번역 문단 수가 원문과 다릅니다.");
  return rows.map((row, index) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("id" in row) ||
      row.id !== paragraphs[index].id ||
      !("text" in row) ||
      typeof row.text !== "string" ||
      !row.text.trim()
    )
      throw new Error("번역 문단이 누락되었거나 순서가 다릅니다.");
    return { id: row.id as string, text: row.text.trim() };
  });
}
export async function deadline<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
        abort = () => reject(new Error("작업이 취소되었습니다."));
        signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
export function wrapText(
  text: string,
  width: number,
  measure: (text: string) => number,
  firstLineWidth = width,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (
        line &&
        measure(line + char) > (lines.length === 0 ? firstLineWidth : width)
      ) {
        lines.push(line.trimEnd());
        line = "";
      }
      line += char;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
