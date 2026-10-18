import { chromium } from "playwright";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const extension = await mkdtemp(join(tmpdir(), "kw-reader-engines-"));
await cp(resolve("dist"), extension, { recursive: true });
const mockTranslator = `
let localMode = "available";
let localCalls = 0;
let localDestroyed = 0;
let releaseLocal;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== "test-local") return false;
  if (message.mode) localMode = message.mode;
  if (message.release) releaseLocal?.();
  respond({ calls: localCalls, destroyed: localDestroyed });
  return false;
});
globalThis.Translator = {
  async availability() { return localMode === "unavailable" ? "unavailable" : "available"; },
  async create() {
    return {
      async translate(text, {signal}) {
        localCalls++;
        if (localMode === "slow") await new Promise((resolve, reject) => {
          releaseLocal = resolve;
          signal.addEventListener("abort", () => reject(new Error("cancelled")), {once:true});
        });
        return "로컬 번역";
      },
      destroy() { localDestroyed++; }
    };
  }
};
`;
await writeFile(
  join(extension, "offscreen.js"),
  mockTranslator + (await readFile(join(extension, "offscreen.js"), "utf8")),
);
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 1100, height: 850 },
});
context.setDefaultTimeout(15000);
let apiRequests = 0;
try {
  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await sw.evaluate(() =>
    chrome.storage.local.set({ enabled: true, apiKey: "test-key-not-real" }),
  );
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    apiRequests++;
    const { paragraphs } = JSON.parse(route.request().postDataJSON().input);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  paragraphs: paragraphs.map(({ id }) => ({
                    id,
                    text: "외부 번역",
                  })),
                }),
              },
            ],
          },
        ],
      }),
    });
  });
  await context.route("https://read.amazon.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><style>body{margin:20px}.kg-full-page-img img{width:1000px;height:700px}</style><div class="kg-full-page-img"></div>',
    }),
  );
  const reader = await context.newPage();
  await reader.goto("https://read.amazon.com/engine-fixture");
  await reader.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 700;
    const c = canvas.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, 1000, 700);
    c.fillStyle = "black";
    c.font = "32px serif";
    c.fillText("The quiet garden is full of light.", 70, 120);
    c.fillText("A small bird waits by the gate.", 70, 170);
    const image = document.createElement("img");
    image.src = canvas.toDataURL();
    document.querySelector(".kg-full-page-img").append(image);
  });
  const controls = reader.locator("#kw-reader-controls");
  const status = controls.getByRole("status");
  const overlay = reader.locator("[data-kw-overlay]:not([data-kw-held])");
  async function ready(text) {
    await status
      .locator(':scope[data-state="ready"]')
      .waitFor({ timeout: 90000 });
    assert(
      (await overlay.evaluate((host) => host.shadowRoot.textContent)).includes(
        text,
      ),
    );
  }
  await ready("외부 번역");
  assert(apiRequests > 0);
  const options = await context.newPage();
  await options.addInitScript(() => {
    window.modelState = {
      availability: "downloadable",
      created: 0,
      destroyed: 0,
      progress: false,
    };
    window.Translator = {
      async availability() {
        return window.modelState.availability;
      },
      async create({ monitor }) {
        window.modelState.created++;
        monitor({
          addEventListener(_type, listener) {
            listener({ loaded: 0.5 });
            window.modelState.progress = true;
          },
        });
        return {
          async translate() {
            return "unused";
          },
          destroy() {
            window.modelState.destroyed++;
          },
        };
      },
    };
  });
  await options.goto(
    `chrome-extension://${new URL(sw.url()).host}/options.html`,
  );
  await options.waitForFunction(
    () => document.querySelector("#enabled").checked,
  );
  assert.equal(
    await options.locator("#translation-engine").inputValue(),
    "openai",
  );
  await options.locator("#translation-engine").selectOption("chrome");
  assert(await options.locator("#key").isDisabled());
  const requestsBeforeLocal = apiRequests;
  await options.getByRole("button", { name: "설정 저장", exact: true }).click();
  await options
    .getByRole("status")
    .filter({ hasText: "저장했습니다" })
    .waitFor();
  const stored = await sw.evaluate(() =>
    chrome.storage.local.get(["translationEngine", "apiKey"]),
  );
  assert.equal(stored.translationEngine, "chrome");
  assert.equal(stored.apiKey, "test-key-not-real");
  assert.deepEqual(await options.evaluate(() => window.modelState), {
    availability: "downloadable",
    created: 1,
    destroyed: 1,
    progress: true,
  });
  await reader.bringToFront();
  await ready("로컬 번역");
  assert.equal(apiRequests, requestsBeforeLocal);

  await sw.evaluate(() =>
    chrome.runtime.sendMessage({ target: "test-local", mode: "unavailable" }),
  );
  await controls.locator("#retry").click();
  await status.locator(':scope[data-state="error"]').waitFor();
  assert.match(await status.getAttribute("title"), /지원하지/);
  assert.equal(apiRequests, requestsBeforeLocal);

  await options.bringToFront();
  await options.evaluate(
    () => (window.modelState.availability = "unavailable"),
  );
  await options.getByRole("button", { name: "설정 저장", exact: true }).click();
  await options.getByRole("status").filter({ hasText: "지원하지" }).waitFor();
  assert(
    await options
      .getByRole("button", { name: "설정 저장", exact: true })
      .isEnabled(),
  );
  await options.locator("#translation-engine").selectOption("openai");
  assert(await options.locator("#key").isEnabled());
  await options.getByRole("button", { name: "설정 저장", exact: true }).click();
  await options
    .getByRole("status")
    .filter({ hasText: "저장했습니다" })
    .waitFor();
  await reader.bringToFront();
  await ready("외부 번역");
  assert(apiRequests > requestsBeforeLocal);

  await sw.evaluate(() => chrome.storage.local.set({ apiKey: "" }));
  await options.bringToFront();
  await options.locator("#translation-engine").selectOption("chrome");
  await options.evaluate(() => (window.modelState.availability = "available"));
  await options.getByRole("button", { name: "설정 저장", exact: true }).click();
  await options
    .getByRole("status")
    .filter({ hasText: "저장했습니다" })
    .waitFor();
  assert.equal(
    (await sw.evaluate(() => chrome.storage.local.get("translationEngine")))
      .translationEngine,
    "chrome",
  );
  await sw.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await sw.evaluate(() =>
    chrome.runtime.sendMessage({ target: "test-local", mode: "slow" }),
  );
  const before = await sw.evaluate(() =>
    chrome.runtime.sendMessage({ target: "test-local" }),
  );
  const pending = sw.evaluate(() =>
    chrome.runtime.sendMessage({
      target: "offscreen",
      type: "translate",
      id: "cancel-local",
      sourceLanguage: "en",
      targetLanguage: "ko",
      paragraphs: [{ id: "one", text: "An original sentence." }],
    }),
  );
  await assertEventually(
    async () =>
      (
        await sw.evaluate(() =>
          chrome.runtime.sendMessage({ target: "test-local" }),
        )
      ).calls > before.calls,
  );
  await sw.evaluate(() =>
    chrome.runtime.sendMessage({
      target: "offscreen",
      type: "cancel",
      id: "cancel-local",
    }),
  );
  assert((await pending).error);
  assert.equal(
    (
      await sw.evaluate(() =>
        chrome.runtime.sendMessage({ target: "test-local" }),
      )
    ).destroyed,
    before.destroyed + 1,
  );
  console.log(
    "Engine selection passed: original overlay, OpenAI default, local model setup without a key, retained key, provider-specific cache, switching back, unsupported local without API fallback, cancellation and cleanup.",
  );
} finally {
  await context.close();
  await rm(extension, { recursive: true, force: true });
}

async function assertEventually(check) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Local translation did not start");
}
