import { translationEngine } from "./translation-engine";
import {
  prepareTranslator,
  LocalTranslationError,
  type LocalTranslator,
} from "./local-translation";
import {
  fillLanguageSelect,
  targetLanguage,
  sourceLanguage,
} from "./languages";
import { deadline, typography, cachePageLimit, MAX_CACHE_PAGES } from "./model";
const languageSelect =
  document.querySelector<HTMLSelectElement>("#target-language")!;
const sourceSelect =
  document.querySelector<HTMLSelectElement>("#source-language")!;
fillLanguageSelect(languageSelect);
fillLanguageSelect(sourceSelect);
const engineSelect = document.querySelector<HTMLSelectElement>(
  "#translation-engine",
)!;
const privacyNotice = document.querySelector<HTMLElement>("#privacy-notice")!;
const modelNotice = document.querySelector<HTMLElement>("#model-notice")!;
const externalPrivacy = privacyNotice.textContent!;
const externalModelNotice = modelNotice.textContent!;
const saveButton = document.querySelector<HTMLButtonElement>(
  'button[type="submit"]',
)!;
const formControls = [
  ...document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement
  >("input, select, button"),
];
let preparation: AbortController | undefined;
const MODEL_PREPARATION_TIMEOUT_MS = 10 * 60_000;
const cachePages = document.querySelector<HTMLInputElement>("#cache-pages")!;
const keyInput = document.querySelector<HTMLInputElement>("#key")!;
const fontFamily = document.querySelector<HTMLSelectElement>("#font-family")!;
const fontScale = document.querySelector<HTMLInputElement>("#font-scale")!;
const enabled = document.querySelector<HTMLInputElement>("#enabled")!;
const status = document.querySelector<HTMLElement>("#status")!;
function renderEngine() {
  const local = engineSelect.value === "chrome";
  keyInput.disabled = local;
  privacyNotice.textContent = local
    ? "OCR 원문과 번역문은 Chrome 로컬 번역기로 기기에서 처리하며 OpenAI에 전송하지 않습니다. API 키와 API 사용료가 필요하지 않습니다. 기존 키는 삭제하지 않습니다."
    : externalPrivacy;
  modelNotice.textContent = local
    ? "데스크톱 Chrome 138 이상이 필요하며 기기와 언어에 따라 지원 여부가 다릅니다. 자동 번역을 켜고 저장하면 최초 모델 다운로드를 준비합니다. 미지원·실패 시 OpenAI로 자동 전환하지 않습니다. 로컬 번역은 오역이나 내용 누락이 있을 수 있습니다."
    : externalModelNotice;
}
engineSelect.addEventListener("change", renderEngine);
window.addEventListener("pagehide", () => preparation?.abort());
async function refresh() {
  const settings = await chrome.storage.local.get([
    "apiKey",
    "translationEngine",
    "enabled",
    "typography",
    "cachePages",
    "targetLanguage",
    "sourceLanguage",
  ]);
  engineSelect.value = translationEngine(settings.translationEngine);
  renderEngine();
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
  if (saveButton.disabled) return;
  void (async () => {
    let localTranslator: LocalTranslator | undefined;
    const engine = translationEngine(engineSelect.value);
    for (const control of formControls) control.disabled = true;
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
      if (enabled.checked && engine === "openai" && !apiKey)
        throw new Error("자동 번역을 켜려면 API 키를 입력하세요.");
      if (enabled.checked && engine === "chrome") {
        preparation = new AbortController();
        localTranslator = await deadline(
          prepareTranslator(
            preparation.signal,
            (message) => {
              status.textContent = message;
            },
            sourceLanguage(sourceSelect.value),
            targetLanguage(languageSelect.value),
            true,
          ),
          MODEL_PREPARATION_TIMEOUT_MS,
          "로컬 번역 모델 준비 시간이 초과되었습니다. 다시 시도하세요.",
          preparation.signal,
        );
      }
      await chrome.storage.local.set({
        translationEngine: engine,
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
        preparation && !(error instanceof LocalTranslationError)
          ? "로컬 번역 모델을 준비하지 못했습니다. 네트워크와 지원 환경을 확인하고 다시 저장하세요."
          : error instanceof Error
            ? error.message
            : "설정을 저장하지 못했습니다.";
    } finally {
      preparation?.abort();
      preparation = undefined;
      localTranslator?.destroy();
      for (const control of formControls) control.disabled = false;
      renderEngine();
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
