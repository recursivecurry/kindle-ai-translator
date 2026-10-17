export const TARGET_LANGUAGES = {
  ko: { label: "한국어", name: "Korean", ocr: "kor" },
  en: { label: "영어", name: "English", ocr: "eng" },
  ja: { label: "일본어", name: "Japanese", ocr: "jpn" },
  "zh-Hans": {
    label: "중국어 (간체)",
    name: "Simplified Chinese",
    ocr: "chi_sim",
  },
  "zh-Hant": {
    label: "중국어 (번체)",
    name: "Traditional Chinese",
    ocr: "chi_tra",
  },
  es: { label: "스페인어", name: "Spanish", ocr: "spa" },
  fr: { label: "프랑스어", name: "French", ocr: "fra" },
  de: { label: "독일어", name: "German", ocr: "deu" },
  pt: { label: "포르투갈어", name: "Portuguese", ocr: "por" },
  vi: { label: "베트남어", name: "Vietnamese", ocr: "vie" },
} as const;
export type TargetLanguage = keyof typeof TARGET_LANGUAGES;
function language(value: unknown, fallback: TargetLanguage): TargetLanguage {
  return typeof value === "string" && Object.hasOwn(TARGET_LANGUAGES, value)
    ? (value as TargetLanguage)
    : fallback;
}

export function targetLanguage(value: unknown): TargetLanguage {
  return language(value, "ko");
}
export function sourceLanguage(value: unknown): TargetLanguage {
  return language(value, "en");
}
export function fillLanguageSelect(select: HTMLSelectElement) {
  for (const [value, language] of Object.entries(TARGET_LANGUAGES))
    select.add(new Option(language.label, value));
}
