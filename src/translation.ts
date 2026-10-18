import type { Paragraph, Translation } from "./model";

export class LocalTranslationError extends Error {}

export type LocalTranslator = {
  translate(text: string, options: { signal: AbortSignal }): Promise<string>;
  destroy(): void;
};
export type TranslatorFactory = {
  availability(options: LanguagePair): Promise<string>;
  create(
    options: LanguagePair & {
      signal: AbortSignal;
      monitor(monitor: {
        addEventListener(
          type: "downloadprogress",
          listener: (event: { loaded: number }) => void,
        ): void;
      }): void;
    },
  ): Promise<LocalTranslator>;
};
type LanguagePair = { sourceLanguage: string; targetLanguage: string };
const MAX_CHUNK_CHARACTERS = 1000;

export async function prepareTranslator(
  signal: AbortSignal,
  progress: (message: string) => void,
  sourceLanguage = "en",
  targetLanguage = "ko",
): Promise<LocalTranslator> {
  const factory = (
    globalThis as typeof globalThis & { Translator?: TranslatorFactory }
  ).Translator;
  if (!factory)
    throw new LocalTranslationError(
      "이 환경은 로컬 번역을 지원하지 않습니다. 데스크톱 Chrome 138 이상에서 다시 시도하세요.",
    );
  const pair = { sourceLanguage, targetLanguage };
  const availability = await factory.availability(pair);
  signal.throwIfAborted();
  if (!["available", "downloadable", "downloading"].includes(availability))
    throw new LocalTranslationError(
      "이 기기 또는 언어 조합은 로컬 번역을 지원하지 않습니다. 다른 언어를 선택하세요.",
    );
  progress(
    availability === "available"
      ? "로컬 번역기를 준비하고 있습니다."
      : "최초 번역 모델을 다운로드합니다. 본문은 전송하지 않습니다.",
  );
  const translator = await factory.create({
    ...pair,
    signal,
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", ({ loaded }) => {
        if (!signal.aborted)
          progress(
            `번역 모델 다운로드 ${Math.round(loaded * 100)}% · 본문은 전송하지 않습니다.`,
          );
      });
    },
  });
  if (signal.aborted) {
    translator.destroy();
    signal.throwIfAborted();
  }
  return translator;
}

export function translationChunks(text: string): string[] {
  let remaining = text.replace(/\s+/gu, " ").trim();
  const chunks: string[] = [];
  while (remaining.length > MAX_CHUNK_CHARACTERS) {
    let end = remaining.lastIndexOf(" ", MAX_CHUNK_CHARACTERS);
    if (end < MAX_CHUNK_CHARACTERS / 2) end = MAX_CHUNK_CHARACTERS;
    if (/[\uD800-\uDBFF]/u.test(remaining[end - 1])) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function translate(
  paragraphs: Paragraph[],
  translator: LocalTranslator,
  signal: AbortSignal,
  progress: (completed: number, total: number) => void = () => {},
): Promise<Translation[]> {
  const translations: Translation[] = [];
  for (const paragraph of paragraphs) {
    const parts: string[] = [];
    for (const chunk of translationChunks(paragraph.text)) {
      signal.throwIfAborted();
      const text = await translator.translate(chunk, { signal });
      signal.throwIfAborted();
      if (!text.trim())
        throw new LocalTranslationError(
          "번역 결과가 비어 있습니다. 다시 시도하세요.",
        );
      parts.push(text.trim());
    }
    translations.push({ id: paragraph.id, text: parts.join(" ") });
    progress(translations.length, paragraphs.length);
  }
  return translations;
}
