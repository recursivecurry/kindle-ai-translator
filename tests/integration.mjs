import { chromium } from "playwright";
import { resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, "138");
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert(
  manifest.content_security_policy.extension_pages.includes(
    "connect-src 'self'",
  ),
);
const files = await readdir("dist");
assert(!files.some((file) => /offscreen|options|kindle-bridge/u.test(file)));
for (const file of ["background.js", "content.js", "panel.js"]) {
  const code = await readFile(`dist/${file}`, "utf8");
  assert(
    !/api\.openai\.com|webpackChunk_amzn|localStorage|indexedDB|storage\.local\.set\(/u.test(
      code,
    ),
  );
}

const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${resolve("dist")}`,
    `--load-extension=${resolve("dist")}`,
  ],
});
context.setDefaultTimeout(15000);
const remoteRequests = [];
const errors = [];
context.on("request", (request) => {
  if (/^https?:/u.test(request.url())) remoteRequests.push(request.url());
});
try {
  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const url = await sw.evaluate(() => chrome.runtime.getURL("panel.html"));
  const panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.addInitScript(() => {
    window.testState = {
      mode: "success",
      calls: [],
      captures: 0,
      destroyed: 0,
      ports: [],
      tabListeners: [],
    };
    const state = window.testState;
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 700;
    const c = canvas.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, 1000, 700);
    c.fillStyle = "black";
    c.font = "32px serif";
    c.fillText("The quiet garden was full of morning light.", 100, 150);
    c.fillText("A small bird waited beside the wooden gate.", 100, 200);
    c.fillText("PRIVATE OUTSIDE REGION", 100, 650);
    const image = canvas.toDataURL();
    chrome.windows.getCurrent = async () => ({ id: 1 });
    chrome.tabs.query = async () => [
      { id: 123, url: "https://read.amazon.com/reader" },
    ];
    chrome.scripting.executeScript = async () => [];
    chrome.tabs.onActivated.addListener = (listener) =>
      state.tabListeners.push(listener);
    chrome.tabs.onUpdated.addListener = () => {};
    chrome.tabs.captureVisibleTab = async () => {
      state.captures++;
      if (state.mode === "capture-error")
        throw new Error("private error content");
      return image;
    };
    chrome.tabs.connect = () => {
      const listeners = [];
      const disconnect = [];
      const port = {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        onDisconnect: { addListener: (listener) => disconnect.push(listener) },
        disconnect: () => disconnect.forEach((listener) => listener()),
        invalidate: () =>
          listeners.forEach((listener) => listener({ revision: 2 })),
      };
      state.ports.push(port);
      setTimeout(
        () =>
          listeners.forEach((listener) =>
            listener({
              revision: 1,
              regions: [{ x: 50, y: 50, width: 900, height: 500 }],
              viewport: { width: 1000, height: 700 },
            }),
          ),
        0,
      );
      return port;
    };
    window.Translator = {
      availability: async () =>
        state.mode === "unsupported" ? "unavailable" : "downloadable",
      create: async ({ monitor }) => {
        monitor({
          addEventListener: (_type, listener) => listener({ loaded: 0.5 }),
        });
        if (state.mode === "download-error")
          throw new Error("private download content");
        return {
          translate: async (text, { signal }) => {
            state.calls.push(text);
            if (state.mode === "slow")
              await new Promise((resolve, reject) => {
                state.finish = resolve;
                signal.addEventListener(
                  "abort",
                  () => reject(new DOMException("Aborted", "AbortError")),
                  { once: true },
                );
              });
            if (state.mode === "translate-error")
              throw new Error("private book content");
            return "조용한 정원에 아침 햇살이 가득했습니다. <script>unsafe()</script>";
          },
          destroy: () => state.destroyed++,
        };
      },
    };
  });
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(url);
  assert.equal(await panel.locator("#source-language").inputValue(), "en");
  await panel.evaluate(() => (window.testState.mode = "unsupported"));
  await panel.locator("#translate").click();
  await panel.getByRole("status").filter({ hasText: "지원하지" }).waitFor();
  assert.equal(await panel.evaluate(() => window.testState.captures), 0);

  await panel.evaluate(() => (window.testState.mode = "download-error"));
  await panel.locator("#translate").click();
  await panel
    .getByRole("status")
    .filter({ hasText: "모델 다운로드 연결" })
    .waitFor();
  assert.equal(await panel.evaluate(() => window.testState.captures), 0);

  await panel.evaluate(() => (window.testState.mode = "capture-error"));
  await panel.locator("#translate").click();
  await panel
    .getByRole("status")
    .filter({ hasText: "화면을 캡처하지" })
    .waitFor();
  assert(!(await panel.locator("#status").textContent()).includes("private"));

  await panel.evaluate(() => (window.testState.mode = "success"));
  const started = performance.now();
  await panel.locator("#translate").click();
  await panel.locator("#result p").first().waitFor({ timeout: 60000 });
  const elapsed = Math.round(performance.now() - started);
  await panel.screenshot({ path: "artifacts/local-panel.png", fullPage: true });
  const calls = await panel.evaluate(() => window.testState.calls);
  assert(
    calls.some((text) => /quiet garden/iu.test(text)),
    JSON.stringify(calls),
  );
  assert(
    calls.every((text) => !text.includes("PRIVATE")),
    JSON.stringify(calls),
  );
  assert.equal(await panel.locator("#result script").count(), 0);
  assert((await panel.locator("#result").textContent()).includes("<script>"));
  assert.equal(await panel.evaluate(() => window.testState.destroyed), 2);
  assert.equal(
    await panel.evaluate(async () => (await indexedDB.databases()).length),
    0,
  );
  assert.equal(
    await panel.evaluate(
      async () => Object.keys(await chrome.storage.local.get(null)).length,
    ),
    0,
  );
  await panel.evaluate(() => window.testState.ports.at(-1).invalidate());
  await panel
    .getByRole("status")
    .filter({ hasText: "페이지가 변경" })
    .waitFor();
  assert.equal(await panel.locator("#result p").count(), 0);

  await panel.evaluate(() => (window.testState.mode = "translate-error"));
  await panel.locator("#translate").click();
  await panel
    .getByRole("status")
    .filter({ hasText: "로컬 번역에 실패" })
    .waitFor({ timeout: 60000 });
  assert(!(await panel.locator("#status").textContent()).includes("private"));

  await panel.evaluate(() => (window.testState.mode = "slow"));
  await panel.locator("#translate").click();
  await panel.waitForFunction(() => !!window.testState.finish, {
    timeout: 60000,
  });
  assert(await panel.locator("#translate").isDisabled());
  await panel.locator("#cancel").click();
  assert.equal(await panel.locator("#result p").count(), 0);
  assert(await panel.locator("#translate").isEnabled());
  await panel.evaluate(() => window.testState.finish());
  assert.equal(await panel.locator("#result p").count(), 0);

  await panel.evaluate(() => (window.testState.mode = "success"));
  await panel.locator("#translate").click();
  await panel.locator("#result p").first().waitFor({ timeout: 60000 });
  await panel.evaluate(() =>
    window.testState.tabListeners.forEach((listener) =>
      listener({ windowId: 1, tabId: 456 }),
    ),
  );
  assert.equal(await panel.locator("#result p").count(), 0);

  const observer = await context.newPage();
  await observer.setContent(
    '<div class="kg-full-page-img"><img style="width:400px;height:300px" /></div>',
  );
  await observer.evaluate(() => {
    window.snapshots = [];
    window.chrome = {
      runtime: {
        id: "test",
        onConnect: {
          addListener: (listener) => {
            window.connectObserver = () =>
              listener({
                name: "visible-page",
                sender: { id: "test" },
                postMessage: (message) => window.snapshots.push(message),
                onDisconnect: {
                  addListener: (callback) =>
                    (window.disconnectObserver = callback),
                },
              });
          },
        },
      },
    };
  });
  await observer.addScriptTag({
    content: await readFile("dist/content.js", "utf8"),
  });
  await observer.evaluate(() => {
    window.connectObserver();
    document.querySelector("img").style.width = "401px";
  });
  await observer.waitForFunction(() => window.snapshots.length >= 2);
  const first = await observer.evaluate(() => window.snapshots[0]);
  assert.equal(first.regions.length, 1);
  assert.equal(first.regions[0].width, 400);
  assert.equal(
    await observer.evaluate(() => window.snapshots.at(-1).regions[0].width),
    401,
  );
  const beforeImageChange = await observer.evaluate(
    () => window.snapshots.length,
  );
  await observer.evaluate(
    () => (document.querySelector("img").src = "data:image/png;base64,invalid"),
  );
  await observer.waitForFunction(
    (previous) => window.snapshots.length > previous,
    beforeImageChange,
  );
  await observer.evaluate(
    () => (document.querySelector("img").style.display = "none"),
  );
  await observer.waitForFunction(
    () => window.snapshots.at(-1).regions.length === 0,
  );
  assert(
    !(await observer.evaluate(() => JSON.stringify(window.snapshots))).includes(
      "data:image",
    ),
  );
  await observer.evaluate(() => window.disconnectObserver());
  assert.deepEqual(remoteRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    `Local OCR + mocked Translator pipeline: ${elapsed}ms; cancellation, retry, crop, page/tab invalidation and zero remote requests passed.`,
  );
} finally {
  await context.close();
}
