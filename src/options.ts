import {
  fillLanguageSelect,
  targetLanguage,
  sourceLanguage,
} from "./languages";
import { typography, cachePageLimit, MAX_CACHE_PAGES } from "./model";
const languageSelect =
  document.querySelector<HTMLSelectElement>("#target-language")!;
const sourceSelect =
  document.querySelector<HTMLSelectElement>("#source-language")!;
fillLanguageSelect(languageSelect);
fillLanguageSelect(sourceSelect);
const cachePages = document.querySelector<HTMLInputElement>("#cache-pages")!;
const keyInput = document.querySelector<HTMLInputElement>("#key")!;
const fontFamily = document.querySelector<HTMLSelectElement>("#font-family")!;
const fontScale = document.querySelector<HTMLInputElement>("#font-scale")!;
const enabled = document.querySelector<HTMLInputElement>("#enabled")!;
const status = document.querySelector<HTMLElement>("#status")!;
async function refresh() {
  const settings = await chrome.storage.local.get([
    "apiKey",
    "enabled",
    "typography",
    "cachePages",
    "targetLanguage",
    "sourceLanguage",
  ]);
  sourceSelect.value = sourceLanguage(settings.sourceLanguage);
  languageSelect.value = targetLanguage(settings.targetLanguage);
  const appearance = typography(settings.typography);
  cachePages.value = String(cachePageLimit(settings.cachePages));
  fontFamily.value = appearance.family;
  fontScale.value = String(Math.round(appearance.scale * 100));
  enabled.checked = settings.enabled === true;
  document.querySelector("#key-state")!.textContent = settings.apiKey
    ? "키가 저장되어 있습니다. 비워 두면 기존 키를 사용합니다."
    : "저장된 키가 없습니다.";
}
void refresh();
document.querySelector("form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const requestedCachePages = Number(cachePages.value);
      if (
        !Number.isInteger(requestedCachePages) ||
        requestedCachePages < 1 ||
        requestedCachePages > MAX_CACHE_PAGES
      )
        throw new Error("캐시는 1~30 사이의 정수로 입력하세요.");
      const current = await chrome.storage.local.get("apiKey");
      const apiKey = keyInput.value.trim() || current.apiKey || "";
      if (enabled.checked && !apiKey)
        throw new Error("자동 번역을 켜려면 API 키를 입력하세요.");
      await chrome.storage.local.set({
        apiKey,
        enabled: enabled.checked,
        targetLanguage: targetLanguage(languageSelect.value),
        sourceLanguage: sourceLanguage(sourceSelect.value),
        cachePages: requestedCachePages,
        typography: typography({
          family: fontFamily.value === "serif" ? "serif" : "sans-serif",
          scale: Number(fontScale.value) / 100,
        }),
        revision: crypto.randomUUID(),
      });
      keyInput.value = "";
      await refresh();
      status.textContent = `저장했습니다. 캐시 ${cachePages.value}개를 모든 킨들 탭에 적용했습니다.`;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "설정을 저장하지 못했습니다.";
    }
  })();
});
document.querySelector("#delete")!.addEventListener("click", () => {
  void (async () => {
    await chrome.storage.local.set({
      apiKey: "",
      enabled: false,
      revision: crypto.randomUUID(),
    });
    keyInput.value = "";
    await refresh();
    status.textContent = "키를 삭제하고 자동 번역을 껐습니다.";
  })();
});

export {};
