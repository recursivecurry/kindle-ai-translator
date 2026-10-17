import type { Worker } from "tesseract.js";
import { decode, recognize, compose, createOcrWorker } from "./imaging";
import {
  deadline,
  OCR_TIMEOUT,
  type Paragraph,
  type Translation,
  typography,
} from "./model";
import { loadTranslationFont } from "./fonts";
import {
  validateWordBoxes,
  refineParagraphCoordinates,
} from "./kindle-coordinates";
type WorkerLease = {
  language: unknown;
  workers: Promise<Worker>[];
  busy: boolean;
  discarded: boolean;
};
type Job = { cancelled: boolean; lease?: WorkerLease };
const OCR_WORKER_COUNT = 2;
let warmWorker: WorkerLease | undefined;
const jobs = new Map<string, Job>();
async function discardLease(lease: WorkerLease | undefined) {
  if (!lease || lease.discarded) return;
  lease.discarded = true;
  if (warmWorker === lease) warmWorker = undefined;
  await Promise.allSettled(
    lease.workers.map(async (worker) => (await worker).terminate()),
  );
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== "offscreen")
    return false;
  if (message.type === "cancel") {
    const job = jobs.get(message.id);
    if (job) {
      job.cancelled = true;
      void discardLease(job.lease);
    }
    respond({ ok: true });
    return false;
  }
  const job: Job = { cancelled: false };
  let succeeded = false;
  jobs.set(message.id, job);
  void (async () => {
    try {
      const timings: Record<string, number> = {};
      const decodeStart = performance.now();
      const canvas = await decode(message.image);
      timings.decodeMs = Math.round(performance.now() - decodeStart);
      if (job.cancelled) throw new Error("취소되었습니다.");
      if (message.type === "ocr") {
        const reused =
          warmWorker &&
          !warmWorker.busy &&
          warmWorker.language === message.sourceLanguage;
        if (!reused) {
          if (warmWorker && !warmWorker.busy) await discardLease(warmWorker);
          warmWorker = {
            language: message.sourceLanguage,
            workers: Array.from({ length: OCR_WORKER_COUNT }, () =>
              createOcrWorker(message.sourceLanguage),
            ),
            busy: false,
            discarded: false,
          };
        }
        const lease = warmWorker!;
        lease.busy = true;
        job.lease = lease;
        timings.workerReused = reused ? 1 : 0;
        const paragraphs = await deadline(
          recognize(
            canvas,
            () => {},
            message.sourceLanguage,
            () => {
              if (job.cancelled) throw new Error("취소되었습니다.");
            },
            timings,
            lease.workers,
          ),
          OCR_TIMEOUT,
          "OCR 시간이 초과되었습니다.",
        );
        if (job.cancelled) throw new Error("취소되었습니다.");
        succeeded = true;
        const boxes = validateWordBoxes(
          message.wordBoxes,
          canvas.width,
          canvas.height,
        );
        const refined = refineParagraphCoordinates(paragraphs, boxes);
        respond({
          paragraphs,
          timings,
          coordinateSource: {
            nativeWords: boxes.length,
            refinedParagraphs: refined,
            ocrParagraphs: paragraphs.length - refined,
          },
        });
      } else if (message.type === "compose") {
        const appearance = typography(message.typography);
        await loadTranslationFont(appearance.family);
        respond(
          compose(
            canvas,
            message.paragraphs as Paragraph[],
            message.translations as Translation[],
            appearance,
          ),
        );
      } else respond({ error: "알 수 없는 이미지 작업입니다." });
    } catch (error) {
      respond({
        error:
          error instanceof Error
            ? error.message
            : "이미지 처리에 실패했습니다.",
      });
    } finally {
      job.cancelled = true;
      if (succeeded && warmWorker === job.lease) job.lease!.busy = false;
      else {
        await discardLease(job.lease);
      }
      if (jobs.get(message.id) === job) jobs.delete(message.id);
    }
  })();
  return true;
});
