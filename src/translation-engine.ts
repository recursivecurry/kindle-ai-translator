export type TranslationEngine = "openai" | "chrome";

export function translationEngine(value: unknown): TranslationEngine {
  return value === "chrome" ? "chrome" : "openai";
}
