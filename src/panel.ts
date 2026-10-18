import type { Worker } from "tesseract.js";
import { fillLanguageSelect } from "./languages";
import { decode, recognize } from "./imaging";
import { deadline } from "./model";
import {
  LocalTranslationError,
  prepareTranslator,
  translate,
  type LocalTranslator,
} from "./translation";

const JOB_TIMEOUT_MS = 10 * 60_000;
const SNAPSHOT_TIMEOUT_MS = 5000;

type Snapshot = {
  revision: number;
  regions: { x: number; y: number; width: number; height: number }[];
  viewport: { width: number; height: number };
};
type Job = {
  controller: AbortController;
  translator?: LocalTranslator;
  worker?: Worker;
  port?: chrome.runtime.Port;
  canvas?: HTMLCanvasElement;
  tabId?: number;
  windowId?: number;
};
const start = document.querySelector<HTMLButtonElement>("#translate")!;
const source = document.querySelector<HTMLSelectElement>("#source-language")!;
const target = document.querySelector<HTMLSelectElement>("#target-language")!;
const status = document.querySelector<HTMLElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
fillLanguageSelect(source);
fillLanguageSelect(target);
source.value = "en";
target.value = "ko";
let current: Job | undefined;

function release(job: Job) {
  job.translator?.destroy();
  job.translator = undefined;
  if (job.worker) void job.worker.terminate();
  job.worker = undefined;
  if (job.canvas) job.canvas.width = job.canvas.height = 0;
  job.canvas = undefined;
}
function clear(message: string) {
  const job = current;
  current = undefined;
  if (job) {
    job.controller.abort();
    release(job);
    job.port?.disconnect();
  }
  result.replaceChildren();
  start.disabled = false;
  source.disabled = target.disabled = false;
  status.textContent = message;
}

async function run(job: Job) {
  const signal = job.controller.signal;
  const update = (message: string) => {
    if (current === job) status.textContent = message;
  };
  let failureMessage =
    "로컬 번역기를 준비하지 못했습니다. 모델 다운로드 연결과 지원 언어를 확인한 뒤 다시 시도하세요.";
  const timeout = setTimeout(() => {
    if (current === job) clear("작업 시간이 초과되었습니다. 다시 시도하세요.");
  }, JOB_TIMEOUT_MS);
  try {
    const window = await chrome.windows.getCurrent();
    signal.throwIfAborted();
    if (window.id === undefined)
      throw new LocalTranslationError("브라우저 창을 확인하지 못했습니다.");
    job.windowId = window.id;
    failureMessage =
      "Kindle 캡처 권한이 없습니다. Kindle 탭에서 확장 아이콘을 다시 누르세요.";
    const [tab] = await chrome.tabs.query({
      active: true,
      windowId: window.id,
    });
    if (
      !tab?.id ||
      !/^https:\/\/read\.amazon\.(com|co\.uk|co\.jp|de)\//u.test(tab.url ?? "")
    )
      throw new LocalTranslationError(
        "지원되는 Kindle 탭에서 확장 아이콘을 누른 뒤 다시 시도하세요.",
      );
    signal.throwIfAborted();
    job.tabId = tab.id;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    signal.throwIfAborted();
    const port = chrome.tabs.connect(tab.id, {
      name: "visible-page",
      frameId: 0,
    });
    job.port = port;
    const snapshot = await deadline(
      new Promise<Snapshot>((resolve, reject) => {
        let first = true;
        port.onMessage.addListener((message: Snapshot) => {
          if (current !== job) return;
          if (first) {
            first = false;
            resolve(message);
          } else
            clear(
              "페이지가 변경되어 이전 결과를 지웠습니다. 현재 페이지를 다시 번역하세요.",
            );
        });
        port.onDisconnect.addListener(() => {
          reject(new Error("Kindle 연결이 끊겼습니다."));
          if (current === job)
            clear("Kindle 연결이 끊겨 결과를 지웠습니다. 다시 시도하세요.");
        });
      }),
      SNAPSHOT_TIMEOUT_MS,
      "Kindle 본문 영역을 확인하지 못했습니다.",
      signal,
    );
    if (!snapshot.regions.length)
      throw new LocalTranslationError(
        "화면에 표시된 Kindle 본문을 찾지 못했습니다. 책을 열고 다시 시도하세요.",
      );
    failureMessage =
      "로컬 번역기를 준비하지 못했습니다. 모델 다운로드 연결과 지원 언어를 확인한 뒤 다시 시도하세요.";
    job.translator = await prepareTranslator(
      signal,
      update,
      source.value,
      target.value,
    );
    signal.throwIfAborted();
    failureMessage =
      "화면을 캡처하지 못했습니다. Kindle 탭에서 확장 아이콘을 다시 누르세요.";
    update("현재 화면을 캡처하고 있습니다.");
    let image = await chrome.tabs.captureVisibleTab(window.id, {
      format: "png",
    });
    signal.throwIfAborted();
    const canvas = await decode(image);
    image = "";
    job.canvas = canvas;
    signal.throwIfAborted();
    const cropped = document.createElement("canvas");
    const scaleX = canvas.width / snapshot.viewport.width;
    const scaleY = canvas.height / snapshot.viewport.height;
    const left = Math.min(...snapshot.regions.map((rect) => rect.x));
    const top = Math.min(...snapshot.regions.map((rect) => rect.y));
    const right = Math.max(
      ...snapshot.regions.map((rect) => rect.x + rect.width),
    );
    const bottom = Math.max(
      ...snapshot.regions.map((rect) => rect.y + rect.height),
    );
    cropped.width = Math.ceil((right - left) * scaleX);
    cropped.height = Math.ceil((bottom - top) * scaleY);
    const context = cropped.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, cropped.width, cropped.height);
    for (const rect of snapshot.regions)
      context.drawImage(
        canvas,
        rect.x * scaleX,
        rect.y * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
        (rect.x - left) * scaleX,
        (rect.y - top) * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
      );
    canvas.width = canvas.height = 0;
    job.canvas = cropped;
    failureMessage =
      "OCR에 실패했거나 인식할 본문이 없습니다. 본문이 보이는지 확인한 뒤 다시 시도하세요.";
    update("기기에서 현재 페이지 본문을 인식하고 있습니다.");
    const paragraphs = await recognize(
      cropped,
      (worker) => {
        job.worker = worker;
        if (signal.aborted) {
          void worker.terminate();
          signal.throwIfAborted();
        }
      },
      source.value,
      () => signal.throwIfAborted(),
    );
    signal.throwIfAborted();
    failureMessage = "로컬 번역에 실패했습니다. 현재 페이지를 다시 시도하세요.";
    const translations = await translate(
      paragraphs,
      job.translator,
      signal,
      (completed, total) => update(`로컬 번역 ${completed}/${total}개 문단`),
    );
    signal.throwIfAborted();
    result.replaceChildren(
      ...translations.map(({ text }) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      }),
    );
    update(`${translations.length}개 문단을 번역했습니다.`);
  } catch (error) {
    if (current === job)
      clear(
        error instanceof LocalTranslationError ? error.message : failureMessage,
      );
  } finally {
    clearTimeout(timeout);
    release(job);
    if (current === job) {
      start.disabled = false;
      source.disabled = target.disabled = false;
    }
  }
}
start.addEventListener("click", () => {
  if (start.disabled) return;
  clear("");
  const job: Job = { controller: new AbortController() };
  current = job;
  start.disabled = true;
  source.disabled = target.disabled = true;
  void run(job);
});
document
  .querySelector("#cancel")!
  .addEventListener("click", () => clear("작업을 취소하고 결과를 지웠습니다."));
for (const select of [source, target])
  select.addEventListener("change", () =>
    clear("언어를 변경했습니다. 현재 페이지를 다시 번역하세요."),
  );
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (current?.windowId === windowId && current.tabId !== tabId)
    clear("탭이 변경되어 결과를 지웠습니다.");
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (current?.tabId === tabId && (change.status === "loading" || change.url))
    clear("페이지가 변경되어 결과를 지웠습니다.");
});
window.addEventListener("pagehide", () => clear(""));
