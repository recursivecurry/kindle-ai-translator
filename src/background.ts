import { translationEngine } from "./translation-engine";
import { translationChunks } from "./local-translation";
import { targetLanguage, sourceLanguage, TARGET_LANGUAGES } from "./languages";
import {
  boundedContext,
  deadline,
  JOB_TIMEOUT,
  typography,
  cachePageLimit,
  validateTranslations,
  type Paragraph,
  type Translation,
  type Composition,
  PAGE_CACHE_TTL,
} from "./model";
import { translate } from "./translation";
import { translationBatches, translationTextKey } from "./translation-plan";
const storageReady = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});
let creating: Promise<void> | undefined;
let queue = Promise.resolve();
const connections = new Set<chrome.runtime.Port>();
const controllers = new Map<chrome.runtime.Port, AbortController>();
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
async function settings() {
  await storageReady;
  const data = await chrome.storage.local.get([
    "enabled",
    "apiKey",
    "translationEngine",
    "revision",
    "typography",
    "cachePages",
    "previousPageMode",
    "targetLanguage",
    "sourceLanguage",
  ]);
  return {
    translationEngine: translationEngine(data.translationEngine),
    targetLanguage: targetLanguage(data.targetLanguage),
    sourceLanguage: sourceLanguage(data.sourceLanguage),
    enabled: data.enabled === true,
    apiKey: typeof data.apiKey === "string" ? data.apiKey : "",
    revision: `${data.revision ?? ""}:${sourceLanguage(data.sourceLanguage)}:${targetLanguage(data.targetLanguage)}:${translationEngine(data.translationEngine)}`,
    typography: typography(data.typography),
    cachePages: cachePageLimit(data.cachePages),
    previousPageMode: data.previousPageMode === true,
  };
}
async function ensureOffscreen() {
  if (!creating)
    creating = (async () => {
      if (
        !(
          await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          })
        ).length
      )
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: [
            chrome.offscreen.Reason.WORKERS,
            chrome.offscreen.Reason.BLOBS,
          ],
          justification: "Run packaged OCR and compose translated text locally",
        });
    })().finally(() => {
      creating = undefined;
    });
  await creating;
}
async function translateLocally(
  paragraphs: Paragraph[],
  id: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal,
): Promise<Translation[]> {
  const response = await deadline(
    chrome.runtime.sendMessage({
      target: "offscreen",
      type: "translate",
      id,
      paragraphs,
      sourceLanguage,
      targetLanguage,
    }),
    JOB_TIMEOUT,
    "로컬 번역 시간이 초과되었습니다.",
    signal,
  );
  if (!response || response.error)
    throw new Error(response?.error || "로컬 번역 응답이 없습니다.");
  return validateTranslations(
    { paragraphs: response.translations },
    paragraphs,
  );
}
function send(port: chrome.runtime.Port, message: unknown) {
  if (connections.has(port)) port.postMessage(message);
}
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== "reader" ||
    port.sender?.id !== chrome.runtime.id ||
    !port.sender.tab
  )
    return;
  const origin = port.sender.origin ?? port.sender.url ?? "";
  if (!/^https:\/\/read\.amazon\.(com|co\.uk|co\.jp|de)(\/|$)/.test(origin))
    return;
  connections.add(port);
  const textCache = new Map<string, { text: string[]; time: number }>();
  const stages = new Map<
    string,
    {
      ocr: {
        paragraphs: Paragraph[];
        coordinateSource: Composition["coordinateSource"];
      };
      time: number;
    }
  >();
  void settings().then(
    ({
      enabled,
      revision,
      cachePages,
      previousPageMode,
      sourceLanguage,
      targetLanguage,
    }) =>
      send(port, {
        type: "settings",
        enabled,
        revision,
        cachePages,
        previousPageMode,
        sourceLanguage,
        targetLanguage,
      }),
  );
  port.onDisconnect.addListener(() => {
    connections.delete(port);
    controllers.get(port)?.abort();
    controllers.delete(port);
  });
  port.onMessage.addListener((message) => {
    if (message.type === "ping") return;
    if (
      message.type === "language" &&
      (message.setting === "sourceLanguage" ||
        message.setting === "targetLanguage")
    ) {
      const value =
        message.setting === "sourceLanguage"
          ? sourceLanguage(message.value)
          : targetLanguage(message.value);
      void chrome.storage.local
        .set({ [message.setting]: value, revision: crypto.randomUUID() })
        .catch(() => {
          send(port, {
            type: "settings-error",
            text: "언어 설정을 저장하지 못했습니다.",
          });
        });
      return;
    }
    if (message.type === "toggle") {
      for (const connection of connections)
        if (connection.sender?.tab?.id === port.sender?.tab?.id)
          send(connection, { type: "toggle" });
      return;
    }
    if (message.type === "cancel") {
      controllers.get(port)?.abort();
      return;
    }
    if (
      message.type === "set-enabled" &&
      typeof message.enabled === "boolean"
    ) {
      void chrome.storage.local
        .set({ enabled: message.enabled, revision: crypto.randomUUID() })
        .catch(() => {
          send(port, {
            type: "settings-error",
            text: "자동 번역 설정을 저장하지 못했습니다.",
          });
        });
      return;
    }
    if (
      message.type === "previous-page" &&
      typeof message.enabled === "boolean"
    ) {
      void chrome.storage.local
        .set({ previousPageMode: message.enabled })
        .catch(() => {
          send(port, {
            type: "settings-error",
            text: "이전 페이지 설정을 저장하지 못했습니다.",
          });
        });
      return;
    }
    if (
      message.type !== "translate" ||
      typeof message.image !== "string" ||
      !message.image.startsWith("data:image/png;base64,") ||
      message.image.length > 24_000_000 ||
      typeof message.id !== "string"
    )
      return;
    controllers.get(port)?.abort();
    const controller = new AbortController();
    controllers.set(port, controller);
    const id = crypto.randomUUID();
    const cancel = () => {
      void chrome.runtime
        .sendMessage({ target: "offscreen", type: "cancel", id })
        .catch(() => {});
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(), JOB_TIMEOUT);
    const queuedAt = performance.now();
    queue = queue.then(async () => {
      const timings: Record<string, number> = {
        queueMs: Math.round(performance.now() - queuedAt),
      };
      try {
        controller.signal.throwIfAborted();
        const config = await settings();
        if (!config.enabled) throw new Error("자동 번역이 꺼져 있습니다.");
        if (config.translationEngine === "openai" && !config.apiKey)
          throw new Error("설정에서 OpenAI API 키를 입력하세요.");
        const offscreenStart = performance.now();
        await ensureOffscreen();
        timings.offscreenMs = Math.round(performance.now() - offscreenStart);
        controller.signal.throwIfAborted();
        send(port, {
          type: "progress",
          id: message.id,
          text: `${TARGET_LANGUAGES[config.sourceLanguage].label} 본문을 인식하고 있습니다.`,
        });
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(message.image),
        );
        const stageKey = JSON.stringify([
          message.book,
          config.sourceLanguage,
          Array.from(new Uint8Array(digest)),
        ]);
        const cached = stages.get(stageKey);
        const fresh =
          cached && Date.now() - cached.time < PAGE_CACHE_TTL
            ? cached
            : undefined;
        const ocrStart = performance.now();
        const ocr =
          fresh?.ocr ??
          (await deadline(
            chrome.runtime.sendMessage({
              target: "offscreen",
              type: "ocr",
              id,
              image: message.image,
              wordBoxes: message.wordBoxes,
              sourceLanguage: config.sourceLanguage,
            }),
            65_000,
            "OCR 응답 시간이 초과되었습니다.",
            controller.signal,
          ));
        controller.signal.throwIfAborted();
        if (!ocr) throw new Error("OCR 응답이 없습니다.");
        if ("error" in ocr && ocr.error) throw new Error(String(ocr.error));
        timings.ocrMs = Math.round(performance.now() - ocrStart);
        if ("timings" in ocr) Object.assign(timings, ocr.timings);
        timings.ocrCacheHit = fresh ? 1 : 0;
        const paragraphs = ocr.paragraphs as Paragraph[];
        const stage = fresh ?? {
          ocr: { paragraphs, coordinateSource: ocr.coordinateSource },
          time: Date.now(),
        };
        stages.delete(stageKey);
        stages.set(stageKey, stage);
        const stageLimit = Math.max(
          config.previousPageMode ? 2 : 1,
          config.cachePages,
        );
        while (stages.size > stageLimit)
          stages.delete(stages.keys().next().value!);
        send(port, {
          type: "progress",
          id: message.id,
          text: `${paragraphs.length}개 문단을 번역하고 있습니다.`,
        });
        const translationStart = performance.now();
        const context = boundedContext(message.previousPage);
        const textKey = translationTextKey(
          message.book,
          config.sourceLanguage,
          config.targetLanguage,
          paragraphs,
          context,
          config.translationEngine,
        );
        const candidate = textCache.get(textKey);
        const cachedTranslation =
          !message.retry &&
          candidate &&
          Date.now() - candidate.time < PAGE_CACHE_TTL
            ? candidate
            : undefined;
        timings.translationCacheHit = cachedTranslation ? 1 : 0;
        timings.textCacheHit = cachedTranslation ? 1 : 0;
        timings.translationRequests = cachedTranslation
          ? 0
          : config.translationEngine === "chrome"
            ? paragraphs.reduce(
                (count, p) => count + translationChunks(p.text).length,
                0,
              )
            : translationBatches(paragraphs).length;
        const translations: Translation[] =
          cachedTranslation?.text.map((text, index) => ({
            id: paragraphs[index].id,
            text,
          })) ??
          (config.translationEngine === "chrome"
            ? await translateLocally(
                paragraphs,
                id,
                config.sourceLanguage,
                config.targetLanguage,
                controller.signal,
              )
            : await translate(
                paragraphs,
                config.apiKey,
                controller.signal,
                context,
                config.targetLanguage,
                config.sourceLanguage,
              ));
        controller.signal.throwIfAborted();
        textCache.delete(textKey);
        textCache.set(textKey, {
          text: translations.map((p) => p.text),
          time: Date.now(),
        });
        while (textCache.size > stageLimit)
          textCache.delete(textCache.keys().next().value!);
        timings.translationMs = Math.round(
          performance.now() - translationStart,
        );
        const composeStart = performance.now();
        const output = await deadline(
          chrome.runtime.sendMessage({
            target: "offscreen",
            type: "compose",
            id,
            image: message.image,
            paragraphs,
            translations,
            typography: config.typography,
          }),
          15_000,
          "이미지 합성 시간이 초과되었습니다.",
          controller.signal,
        );
        controller.signal.throwIfAborted();
        if (output.error) throw new Error(output.error);
        timings.composeMs = Math.round(performance.now() - composeStart);
        timings.totalMs = Math.round(performance.now() - queuedAt);
        send(port, {
          type: "result",
          id: message.id,
          ...output,
          timings,
          targetLanguage: config.targetLanguage,
          count: paragraphs.length,
          coordinateSource: ocr.coordinateSource,
          context: boundedContext(
            paragraphs.map((p, index) => ({
              source: p.text,
              translation: translations[index].text,
            })),
          ),
        });
      } catch (error) {
        send(port, {
          type: "error",
          id: message.id,
          text: controller.signal.aborted
            ? "작업이 취소되었거나 제한 시간을 초과했습니다."
            : error instanceof Error
              ? error.message
              : "번역에 실패했습니다.",
        });
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", cancel);
        if (controllers.get(port) === controller) controllers.delete(port);
      }
    });
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (Object.keys(changes).some((key) => key !== "previousPageMode"))
    for (const controller of controllers.values()) controller.abort();
  void settings().then(
    ({
      enabled,
      revision,
      cachePages,
      previousPageMode,
      sourceLanguage,
      targetLanguage,
    }) => {
      for (const port of connections)
        send(port, {
          type: "settings",
          enabled,
          revision,
          cachePages,
          previousPageMode,
          sourceLanguage,
          targetLanguage,
        });
    },
  );
});
