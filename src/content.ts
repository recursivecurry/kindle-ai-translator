import {
  fillLanguageSelect,
  sourceLanguage,
  targetLanguage,
} from "./languages";
import {
  deadline,
  JOB_TIMEOUT,
  type PageContext,
  type Composition,
  cachePageLimit,
  DEFAULT_CACHE_PAGES,
  PAGE_CACHE_TTL,
  boundedContext,
} from "./model";
import { imagePlacement } from "./layout";
import { createOverlay } from "./rendering";
import {
  COORDINATE_ATTRIBUTE,
  COORDINATE_EVENT,
  validateWordBoxes,
} from "./kindle-coordinates";
import { PageHistory } from "./page-history";
const STABILITY_MS = 300;
const POLL_MS = 250;
const CACHE_BYTES = 24_000_000;
let cachePages = DEFAULT_CACHE_PAGES;
let previousPageMode = false;
const pageHistory = new PageHistory();
let previewTask: Promise<void> | undefined;
let readinessEpoch: number | undefined;
let navigationSnapshot:
  { location: number | undefined; sources: string } | undefined;
let preparedSnapshot: typeof navigationSnapshot;
const pageSources = (images: HTMLImageElement[]) =>
  images.map((image) => image.currentSrc).join("|");
let showingPrevious = false;
let retryTranslation = false;
type Output = Composition & {
  count: number;
  context: PageContext;
};
let book = "";
function readingLocation(): number | undefined {
  const documents = [document];
  try {
    if (window.top && window.top.document !== document)
      documents.push(window.top.document);
  } catch {
    /* Cross-origin readers use their own location display. */
  }
  for (const doc of documents) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest("script,style,#kw-reader-controls,[data-kw-overlay]")
      )
        continue;
      const match = node.textContent?.match(
        /\bLocation\s+([\d,]+)\s+of\s+[\d,]+/i,
      );
      if (match && parent.getClientRects().length) {
        const value = Number(match[1].replaceAll(",", ""));
        if (Number.isSafeInteger(value) && value > 0) return value;
      }
    }
  }
}
function rememberPageTurn(direction: number) {
  traceCache("navigate", { direction });
  const location = readingLocation();
  navigationSnapshot =
    preparedSnapshot?.location === location
      ? preparedSnapshot
      : { location, sources: pageSources(pages()) };
  pageHistory.navigate(readingLocation(), direction);
  if (enabled && previousPageMode) holdDisplay();
}
document.addEventListener(
  "pointerdown",
  () => pageHistory.cancelNavigation(),
  true,
);
document.addEventListener(
  "click",
  (event) => {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const label =
        node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "";
      if (node.id === "kr-chevron-right" || /^Next page$/i.test(label)) {
        rememberPageTurn(1);
        return;
      }
      if (node.id === "kr-chevron-left" || /^Previous page$/i.test(label)) {
        rememberPageTurn(-1);
        return;
      }
    }
  },
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.isContentEditable ||
              /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) ||
              node.closest("#kw-reader-controls")),
        )
    )
      return;
    if (event.key === "ArrowRight") rememberPageTurn(1);
    if (event.key === "ArrowLeft") rememberPageTurn(-1);
  },
  true,
);
function bookIdentity() {
  try {
    const url = new URL(window.top!.location.href);
    return (
      url.origin +
      url.pathname +
      (url.searchParams.get("asin") ?? "") +
      url.hash
    );
  } catch {
    return location.href;
  }
}
type Pending = {
  resolve: (value: Output) => void;
  reject: (error: Error) => void;
};
const port = chrome.runtime.connect({ name: "reader" });
let enabled = false,
  revision = "",
  generation = 0,
  signature = "",
  changedAt = 0,
  started = false,
  original = false,
  connected = true;
const pending = new Map<string, Pending>();
const overlays = new Map<HTMLImageElement, HTMLDivElement>();
const heldOverlays = new Set<HTMLDivElement>();
const ids = new WeakMap<HTMLImageElement, number>();
const cache = new Map<
  string,
  {
    output: Output | undefined;
    source: string;
    time: number;
    width: number;
    height: number;
  }
>();
let protectedCacheKeys = new Set<string>();
let nextId = 0;
const host = document.createElement("div");
host.id = "kw-reader-controls";
const cacheDiagnostics: object[] = [];
function traceCache(event: string, details: object = {}) {
  cacheDiagnostics.push({
    event,
    time: Date.now(),
    location: readingLocation(),
    limit: cachePages,
    size: cache.size,
    ...details,
  });
  if (cacheDiagnostics.length > 40) cacheDiagnostics.shift();
  host.dataset.kwCache = JSON.stringify(cacheDiagnostics);
}
const shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML =
  '<style>:host{position:fixed;bottom:18px;right:18px;z-index:2147483647;font:13px system-ui;color:#243b30}section{width:max-content;max-width:calc(100vw - 60px);padding:12px;background:#fffffff5;border:1px solid #a9bcaf;border-radius:10px;box-shadow:0 3px 16px #0002}label{display:inline-flex;align-items:center;gap:4px}select{font:inherit;max-width:130px}.languages{display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap}nav{display:flex;gap:5px;overflow-x:auto}p{display:flex;align-items:center;gap:8px;margin:0 0 8px;line-height:1.5}.spinner{width:12px;height:12px;border:2px solid #c1cec4;border-top-color:#243b30;border-radius:50%;animation:spin .8s linear infinite}.indicator[hidden]{display:none}.error{color:#a33;font-weight:bold}@keyframes spin{to{transform:rotate(360deg)}}#previous-page::before{content:"○";margin-right:5px}#previous-page[aria-pressed="true"]{background:#245d43;color:white;border-color:#245d43}#previous-page[aria-pressed="true"]::before{content:"✓"}button{font:inherit;border:1px solid #c1cec4;background:#f3f7f3;color:#243b30;border-radius:5px;padding:5px 8px;flex:none;white-space:nowrap;cursor:pointer}</style><section><p role="status" data-state="idle"><span id="page-label">현재 페이지</span><span class="indicator" hidden></span></p><div class="languages"><label>원본 <select id="source-language" aria-label="원본 언어"></select></label><label>번역 <select id="target-language" aria-label="번역할 언어"></select></label></div><nav><button id="view">원문 보기</button><button id="retry">재시도</button><button id="disable">번역 끄기</button></nav></section>';
const sourceSelect =
  shadow.querySelector<HTMLSelectElement>("#source-language")!;
const targetSelect =
  shadow.querySelector<HTMLSelectElement>("#target-language")!;
for (const [select, setting] of [
  [sourceSelect, "sourceLanguage"],
  [targetSelect, "targetLanguage"],
] as const) {
  fillLanguageSelect(select);
  select.addEventListener("change", () => {
    if (connected) send({ type: "language", setting, value: select.value });
  });
}
sourceSelect.value = "en";
targetSelect.value = "ko";
const status = shadow.querySelector("p")!;
function setStatus(
  detail: string,
  state: "idle" | "loading" | "ready" | "error",
) {
  status.dataset.state = state;
  status.title = detail;
  status.querySelector("#page-label")!.textContent =
    showingPrevious || heldOverlays.size > 0 ? "이전 페이지" : "현재 페이지";
  const indicator = status.querySelector<HTMLSpanElement>(".indicator")!;
  indicator.hidden = state !== "loading" && state !== "error";
  indicator.className =
    "indicator " + (state === "loading" ? "spinner" : "error");
  indicator.textContent = state === "error" ? "!" : "";
  indicator.setAttribute("role", "img");
  indicator.setAttribute(
    "aria-label",
    state === "loading" ? "번역 중" : detail,
  );
}
const previousToggle = document.createElement("button");
previousToggle.id = "previous-page";
previousToggle.textContent = "이전 페이지 보기";
previousToggle.setAttribute("aria-label", "이전 페이지 보기");
previousToggle.title =
  "한 페이지 이전의 번역본을 표시해 현재 페이지의 번역을 기다리는 시간을 줄입니다.";
previousToggle.setAttribute("aria-pressed", "false");
previousToggle.addEventListener("click", () => {
  if (connected) send({ type: "previous-page", enabled: !previousPageMode });
});
shadow.querySelector("nav")!.append(previousToggle);
function holdDisplay() {
  for (const overlay of overlays.values()) {
    overlay.dataset.kwHeld = "true";
    heldOverlays.add(overlay);
  }
  overlays.clear();
  setStatus("페이지를 준비하고 있습니다.", "loading");
}
function releaseHeldDisplay() {
  for (const overlay of heldOverlays) overlay.remove();
  heldOverlays.clear();
}
function clear(preserveDisplay = false) {
  previewTask = undefined;
  readinessEpoch = undefined;
  showingPrevious = false;
  generation++;
  if (preserveDisplay) holdDisplay();
  else {
    for (const overlay of overlays.values()) overlay.remove();
    overlays.clear();
    releaseHeldDisplay();
  }
  for (const request of pending.values())
    request.reject(new Error("페이지가 변경되었습니다."));
  pending.clear();
  if (connected) send({ type: "cancel" });
  started = false;
}
function visible(element: Element): boolean {
  if (document.visibilityState !== "visible") return false;
  let node: Element | null = element;
  while (node) {
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      node.hasAttribute("hidden")
    )
      return false;
    node = node.parentElement;
  }
  const r = element.getBoundingClientRect();
  let visibleLeft = Math.max(0, r.left),
    visibleTop = Math.max(0, r.top),
    visibleRight = Math.min(innerWidth, r.right),
    visibleBottom = Math.min(innerHeight, r.bottom);
  node = element.parentElement;
  while (node) {
    const s = getComputedStyle(node);
    if (
      /hidden|clip|scroll|auto/.test(s.overflow + s.overflowX + s.overflowY)
    ) {
      const b = node.getBoundingClientRect();
      visibleLeft = Math.max(visibleLeft, b.left);
      visibleTop = Math.max(visibleTop, b.top);
      visibleRight = Math.min(visibleRight, b.right);
      visibleBottom = Math.min(visibleBottom, b.bottom);
    }
    node = node.parentElement;
  }
  if (visibleRight - visibleLeft < 30 || visibleBottom - visibleTop < 30)
    return false;
  if (
    r.width < 30 ||
    r.height < 30 ||
    r.bottom <= 0 ||
    r.right <= 0 ||
    r.top >= innerHeight ||
    r.left >= innerWidth
  )
    return false;
  try {
    let frame: Window = window;
    while (frame !== frame.parent) {
      const container = frame.frameElement;
      if (
        !container ||
        !container.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        })
      )
        return false;
      const b = container.getBoundingClientRect();
      if (
        b.bottom <= 0 ||
        b.right <= 0 ||
        b.top >= frame.parent.innerHeight ||
        b.left >= frame.parent.innerWidth
      )
        return false;
      frame = frame.parent;
    }
  } catch {
    return false;
  }
  return true;
}
function pages() {
  return [
    ...document.querySelectorAll<HTMLImageElement>(".kg-full-page-img img"),
  ].filter((image) => !image.dataset.kwOverlay && visible(image));
}
function fingerprint(images: HTMLImageElement[]) {
  return images
    .map((image) => {
      if (!ids.has(image)) ids.set(image, ++nextId);
      const r = image.getBoundingClientRect();
      const styles: string[] = [];
      let node: Element | null = image;
      while (node) {
        styles.push(
          node.getAttribute("class") ?? "",
          node.getAttribute("style") ?? "",
        );
        node = node.parentElement;
      }
      return [
        ids.get(image),
        image.currentSrc,
        image.naturalWidth,
        image.naturalHeight,
        image.complete,
        r.width,
        r.height,
        r.x,
        r.y,
        ...styles,
      ].join("|");
    })
    .join("\n");
}
function position() {
  for (const [image, overlay] of overlays) {
    const r = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    let left = Math.max(0, r.left),
      top = Math.max(0, r.top),
      right = Math.min(innerWidth, r.right),
      bottom = Math.min(innerHeight, r.bottom);
    let node = image.parentElement;
    const filters = style.filter === "none" ? [] : [style.filter];
    while (node) {
      const s = getComputedStyle(node);
      if (s.filter !== "none") filters.push(s.filter);
      if (
        /hidden|clip|scroll|auto/.test(s.overflow + s.overflowX + s.overflowY)
      ) {
        const b = node.getBoundingClientRect();
        left = Math.max(left, b.left);
        top = Math.max(top, b.top);
        right = Math.min(right, b.right);
        bottom = Math.min(bottom, b.bottom);
      }
      node = node.parentElement;
    }
    Object.assign(overlay.style, {
      position: "fixed",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      filter: filters.join(" ") || "none",
      clipPath: `inset(${Math.max(0, top - r.top)}px ${Math.max(0, r.right - right)}px ${Math.max(0, r.bottom - bottom)}px ${Math.max(0, left - r.left)}px)`,
      pointerEvents: "none",
      zIndex: "2147483645",
      display:
        (original &&
          !overlay.shadowRoot!.querySelector("[data-kw-original]")) ||
        !visible(image)
          ? "none"
          : "block",
    });
    overlay.toggleAttribute("data-kw-show-original", original);
    const sheet =
      overlay.shadowRoot!.querySelector<HTMLElement>("[data-kw-sheet]")!;
    const placement = imagePlacement(
      parseFloat(sheet.style.width),
      parseFloat(sheet.style.height),
      r.width,
      r.height,
      style.objectFit,
      style.objectPosition,
    );
    sheet.style.transform = `translate(${placement.x}px, ${placement.y}px) scale(${placement.scaleX}, ${placement.scaleY})`;
  }
}
function cachePut(
  key: string,
  output: Output | undefined,
  source: string,
  width: number,
  height: number,
) {
  cache.delete(key);
  cache.set(key, { output, source, time: Date.now(), width, height });
  traceCache("put", { key: key.slice(-16), translated: !!output });
  let bytes = [...cache.values()].reduce(
    (sum, item) => sum + (item.output?.image.length ?? 0) + item.source.length,
    0,
  );
  while (bytes > CACHE_BYTES || cache.size > cachePages) {
    const first = [...cache.keys()].find((key) => !protectedCacheKeys.has(key));
    if (first === undefined) break;
    const entry = cache.get(first)!;
    bytes -= (entry.output?.image.length ?? 0) + entry.source.length;
    cache.delete(first);
    traceCache("evict", { key: first.slice(-16), bytes });
  }
}
function cachedPage(key: string) {
  const cached = cache.get(key);
  if (!cached) {
    traceCache("miss", { key: key.slice(-16) });
    return;
  }
  if (
    !protectedCacheKeys.has(key) &&
    Date.now() - cached.time >= PAGE_CACHE_TTL
  ) {
    cache.delete(key);
    traceCache("expired", { key: key.slice(-16) });
    return;
  }
  cache.delete(key);
  cache.set(key, cached);
  traceCache("hit", { key: key.slice(-16), translated: !!cached.output });
  return cached;
}
async function displayPage(
  image: HTMLImageElement,
  output: Output,
  width: number,
  height: number,
  epoch: number,
  source?: string,
) {
  const overlay = await createOverlay(output, width, height, source);
  if (epoch !== generation) return;
  overlays.get(image)?.remove();
  overlays.set(image, overlay);
  document.documentElement.append(overlay);
  position();
}
async function processPages(images: HTMLImageElement[], epoch: number) {
  let skipped = 0,
    total = 0;
  try {
    await previewTask;
    if (epoch !== generation) return;
    const prepared: { image: HTMLImageElement; data: string; key: string }[] =
      [];
    for (const image of images) {
      if (epoch !== generation) return;
      if (!image.complete || !image.naturalWidth)
        throw new Error(
          "본문 이미지가 아직 로드되지 않았습니다. 다시 시도하세요.",
        );
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      if (canvas.width * canvas.height > 16_000_000)
        throw new Error("본문 이미지가 너무 큽니다. 글자 크기를 조정하세요.");
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      let data: string;
      try {
        data = canvas.toDataURL("image/png");
      } catch {
        throw new Error("본문 이미지에 접근할 수 없어 원문을 표시합니다.");
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(data),
      );
      const key =
        book +
        revision +
        Array.from(new Uint8Array(digest), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
      if (epoch !== generation) return;
      prepared.push({ image, data, key });
    }
    const keys = prepared.map((page) => page.key);
    const location = readingLocation();
    preparedSnapshot = { location, sources: pageSources(images) };
    pageHistory.record(location, keys, pageLayout(images));
    showingPrevious = false;
    const prior = pageHistory.previous(location);
    protectedCacheKeys = new Set(
      previousPageMode ? [...keys, ...(prior?.keys ?? [])] : [],
    );
    for (const { key, data, image } of prepared)
      if (!cachedPage(key))
        cachePut(key, undefined, data, image.naturalWidth, image.naturalHeight);
    traceCache("previous", { previous: prior?.location ?? null });
    const previousWork: typeof prepared = [];
    if (previousPageMode && prior?.keys.length === images.length) {
      const previous = prior.keys.map(cachedPage);
      if (previous.every((page) => page !== undefined)) {
        for (const [index, page] of previous.entries()) {
          await displayPage(
            images[index],
            page.output ?? {
              image: page.source,
              regions: [],
              skipped: [],
              diagnostics: [],
              count: 0,
              context: [],
            },
            page.width,
            page.height,
            epoch,
            page.source,
          );
          if (epoch !== generation) return;
          if (!page.output)
            previousWork.push({
              image: images[index],
              data: page.source,
              key: prior.keys[index],
            });
        }
        releaseHeldDisplay();
        showingPrevious = true;
        setStatus("현재 페이지를 준비하고 있습니다.", "loading");
        for (const overlay of overlays.values()) {
          overlay.dataset.kwLocation = String(prior.location);
          overlay.dataset.kwCurrentLocation = String(location);
        }
      }
    }
    for (const { image, data, key } of [...previousWork, ...prepared]) {
      if (epoch !== generation) return;
      const cached = cachedPage(key);
      const isPreviousWork = previousWork.some((page) => page.key === key);
      const width = cached?.width ?? image.naturalWidth;
      const height = cached?.height ?? image.naturalHeight;
      let output: Output;
      if (cached?.output) output = cached.output;
      else {
        const workLocation = isPreviousWork ? prior?.location : location;
        const preceding = pageHistory.previous(workLocation);
        const workKeys = isPreviousWork ? prior!.keys : keys;
        const contextKeys = [
          ...(preceding?.keys ?? []),
          ...workKeys.slice(0, workKeys.indexOf(key)),
        ];
        const context = boundedContext(
          contextKeys.flatMap((contextKey) => {
            const entry = cache.get(contextKey);
            return entry && Date.now() - entry.time < PAGE_CACHE_TTL
              ? (entry.output?.context ?? [])
              : [];
          }),
        );
        traceCache("context", {
          workLocation,
          previousLocation: preceding?.location ?? null,
          pairs: context.length,
        });
        const id = crypto.randomUUID();
        const result = new Promise<Output>((resolve, reject) =>
          pending.set(id, { resolve, reject }),
        );
        send({
          type: "translate",
          id,
          book,
          retry: retryTranslation,
          image: data,
          wordBoxes: (() => {
            if (isPreviousWork) return [];
            image.dispatchEvent(new Event(COORDINATE_EVENT, { bubbles: true }));
            const raw = image.getAttribute(COORDINATE_ATTRIBUTE);
            image.removeAttribute(COORDINATE_ATTRIBUTE);
            if (!raw || raw.length > 1000000) return [];
            try {
              return validateWordBoxes(
                JSON.parse(raw),
                image.naturalWidth,
                image.naturalHeight,
              );
            } catch {
              return [];
            }
          })(),
          previousPage: context,
        });
        try {
          output = await deadline(
            result,
            JOB_TIMEOUT + 5000,
            "번역 시간이 초과되었습니다. 다시 시도하세요.",
          );
        } finally {
          pending.delete(id);
        }
        if (epoch !== generation) return;
        cachePut(key, output, data, width, height);
      }
      if (epoch !== generation || !visible(image)) return;
      if (!showingPrevious || isPreviousWork)
        await displayPage(
          image,
          output,
          width,
          height,
          epoch,
          previousPageMode ? data : undefined,
        );
      if (epoch !== generation) return;
      if (isPreviousWork) {
        const overlay = overlays.get(image)!;
        overlay.dataset.kwLocation = String(prior!.location);
        overlay.dataset.kwCurrentLocation = String(location);
      }
      if (!isPreviousWork) {
        skipped += output.skipped.length;
        total += output.count;
      }
    }
    releaseHeldDisplay();
    retryTranslation = false;
    setStatus(
      (showingPrevious
        ? "이전 페이지 표시 중 · 현재 페이지 준비 완료. "
        : previousPageMode
          ? "이전 캐시가 없어 현재 페이지를 표시합니다. "
          : "") +
        (skipped
          ? `${total}개 문단 중 ${skipped}개는 배경·인식·공간 문제로 원문을 유지했습니다.`
          : `${total}개 문단을 번역했습니다.`),
      "ready",
    );
  } catch (error) {
    if (epoch !== generation) return;
    if (!showingPrevious) {
      for (const overlay of overlays.values()) overlay.remove();
      overlays.clear();
    }
    send({ type: "cancel" });
    setStatus(
      (showingPrevious ? "이전 페이지 표시 중 · 현재 페이지 준비 실패: " : "") +
        (error instanceof Error
          ? error.message
          : "번역에 실패하여 원문을 표시합니다."),
      "error",
    );
  }
}
function pageLayout(images: HTMLImageElement[]) {
  return JSON.stringify([
    innerWidth,
    innerHeight,
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return [
        image.naturalWidth,
        image.naturalHeight,
        rect.width,
        rect.height,
        style.objectFit,
        style.objectPosition,
      ];
    }),
  ]);
}
async function previewCachedPage(images: HTMLImageElement[], epoch: number) {
  const location = readingLocation();
  const prior = pageHistory.previewPrevious(location);
  if (
    !prior ||
    prior.layout !== pageLayout(images) ||
    prior.keys.length !== images.length
  )
    return;
  const cached = prior.keys.map(cachedPage);
  if (!cached.every((page) => page !== undefined)) return;
  for (const [index, page] of cached.entries()) {
    await displayPage(
      images[index],
      page.output ?? {
        image: page.source,
        regions: [],
        skipped: [],
        diagnostics: [],
        count: 0,
        context: [],
      },
      page.width,
      page.height,
      epoch,
      page.source,
    );
    if (epoch !== generation) return;
    const overlay = overlays.get(images[index])!;
    overlay.dataset.kwLocation = String(prior.location);
    overlay.dataset.kwCurrentLocation = String(location);
  }
  releaseHeldDisplay();
  showingPrevious = true;
  setStatus("현재 페이지를 확인하고 있습니다.", "loading");
  traceCache("preview", { previous: prior.location });
}
function tick() {
  if (!connected) return;
  const currentBook = bookIdentity();
  if (book !== currentBook) {
    traceCache("book-changed", { from: book, to: currentBook });
    book = currentBook;
    preparedSnapshot = undefined;
    pageHistory.clear();
    cache.clear();
    clear();
    signature = "";
    changedAt = Date.now();
  }
  const images = pages();
  host.hidden = images.length === 0;
  if (images.length && !host.isConnected) document.documentElement.append(host);
  const current = enabled
    ? `${readingLocation() ?? "unknown"}|${fingerprint(images)}`
    : "";
  if (current !== signature) {
    signature = current;
    clear(enabled && previousPageMode);
    changedAt = Date.now();
    setStatus(
      enabled
        ? "페이지가 안정되기를 기다리고 있습니다."
        : "자동 번역이 꺼져 있습니다.",
      enabled ? "loading" : "idle",
    );
    if (enabled && previousPageMode && images.length)
      previewTask = previewCachedPage(images, generation).catch(() => {
        traceCache("preview-failed");
      });
  }
  position();
  if (!enabled || !images.length || started || readinessEpoch === generation)
    return;
  void checkReadiness(images, generation);
}
async function checkReadiness(images: HTMLImageElement[], epoch: number) {
  readinessEpoch = epoch;
  const expected = signature;
  const unchanged = () =>
    epoch === generation &&
    connected &&
    enabled &&
    expected === `${readingLocation() ?? "unknown"}|${fingerprint(pages())}`;
  try {
    await Promise.all(images.map((image) => image.decode()));
    for (let frame = 0; frame < 2; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (!unchanged()) return;
    }
    const location = readingLocation();
    const navigationReady =
      !navigationSnapshot ||
      (navigationSnapshot.location !== location &&
        navigationSnapshot.sources !== pageSources(images));
    const mode =
      location !== undefined && navigationReady ? "decoded-frames" : "fallback";
    if (mode === "fallback") {
      const remaining = Math.max(0, STABILITY_MS - (Date.now() - changedAt));
      if (remaining)
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }
    if (!unchanged() || started) return;
    navigationSnapshot = undefined;
    started = true;
    traceCache("ready", { waitMs: Date.now() - changedAt, mode });
    setStatus("이미지를 준비하고 있습니다.", "loading");
    void processPages(images, epoch);
  } catch (error) {
    if (epoch === generation)
      setStatus(
        error instanceof Error
          ? error.message
          : "본문 이미지를 읽을 수 없습니다.",
        "error",
      );
  } finally {
    if (readinessEpoch === epoch) readinessEpoch = undefined;
  }
}

port.onMessage.addListener((message) => {
  if (message.type === "settings-error") {
    setStatus(message.text, "error");
    return;
  }
  if (message.type === "toggle") {
    toggleView();
    return;
  }
  if (message.type === "settings") {
    const changed =
      enabled !== message.enabled || revision !== message.revision;
    sourceSelect.value = sourceLanguage(message.sourceLanguage);
    targetSelect.value = targetLanguage(message.targetLanguage);
    enabled = message.enabled;
    shadow.querySelector("#disable")!.textContent = enabled
      ? "번역 끄기"
      : "번역 켜기";
    revision = message.revision;
    cachePages = cachePageLimit(message.cachePages);
    previousPageMode = message.previousPageMode === true;
    previousToggle.setAttribute("aria-pressed", String(previousPageMode));

    shadow.querySelector("#view")!.textContent = original
      ? "번역 보기"
      : "원문 보기";
    if (changed) {
      traceCache("settings-changed");
      cache.clear();
      pageHistory.clear();
    }
    clear();
    signature = "";
    changedAt = Date.now();
    setStatus(
      enabled
        ? "본문을 기다리고 있습니다."
        : "자동 번역이 꺼져 있습니다. ‘번역 켜기’를 누르면 다시 시작합니다.",
      "idle",
    );
    return;
  }
  const request = pending.get(message.id);
  if (!request) return;
  if (message.type === "result") {
    traceCache("timing", message.timings ?? {});
    request.resolve(message);
  } else if (message.type === "error") request.reject(new Error(message.text));
  else if (message.type === "progress")
    setStatus(
      (showingPrevious ? "이전 페이지 표시 중 · " : "") + message.text,
      "loading",
    );
});
function disconnect() {
  if (!connected) return;
  connected = false;
  clear();
  setStatus("확장 연결이 끊겼습니다. 킨들 탭을 새로고침하세요.", "error");
  clearInterval(poll);
  clearInterval(heartbeat);
  observer.disconnect();
}
port.onDisconnect.addListener(disconnect);
function send(message: unknown) {
  if (!connected) return;
  try {
    port.postMessage(message);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/Extension context invalidated|disconnected port/i.test(error.message)
    )
      throw error;
    disconnect();
  }
}
function toggleView() {
  original = !original;
  for (const overlay of heldOverlays)
    overlay.toggleAttribute("data-kw-show-original", original);
  shadow.querySelector("#view")!.textContent = original
    ? "번역 보기"
    : "원문 보기";
  position();
}
shadow
  .querySelector("#view")!
  .setAttribute("title", "원문/번역 전환: Alt+Shift+T (Mac: Option+Shift+T)");
shadow
  .querySelector("#view")!
  .addEventListener("click", () => send({ type: "toggle" }));
document.addEventListener(
  "keydown",
  (event) => {
    if (
      !connected ||
      event.repeat ||
      event.isComposing ||
      event.code !== "KeyT" ||
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.isContentEditable ||
              /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)),
        )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    send({ type: "toggle" });
  },
  true,
);
shadow.querySelector("#retry")!.addEventListener("click", () => {
  retryTranslation = true;
  traceCache("retry");
  cache.clear();
  clear();
  changedAt = Date.now() - STABILITY_MS;
  tick();
});
shadow.querySelector("#disable")!.addEventListener("click", () => {
  if (connected) send({ type: "set-enabled", enabled: !enabled });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clear();
    signature = "";
  }
  tick();
});
window.addEventListener("pagehide", () => {
  clear();
  if (connected) {
    port.disconnect();
    disconnect();
  }
});
window.addEventListener("scroll", position, true);
window.addEventListener("resize", () => {
  traceCache("resize");
  pageHistory.clear();
  tick();
});
const poll = setInterval(tick, POLL_MS);
const heartbeat = setInterval(() => {
  if (connected) send({ type: "ping" });
}, 20_000);
const observer = new MutationObserver((records) => {
  if (
    records.some(
      (record) =>
        record.target instanceof Element &&
        !record.target.closest("#kw-reader-controls,[data-kw-overlay]"),
    )
  )
    tick();
});
observer.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["src", "srcset", "style", "class", "hidden", "aria-hidden"],
});
window.addEventListener("pagehide", () => observer.disconnect());
tick();
