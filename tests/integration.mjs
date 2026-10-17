import { chromium } from "playwright";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${resolve("dist")}`,
    `--load-extension=${resolve("dist")}`,
  ],
  viewport: { width: 1100, height: 850 },
});
let requests = [];
let mode = "success";
let slowResolve;
let onSlowRequest;
try {
  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      enabled: true,
      apiKey: "test-key-not-real",
      revision: "test",
    });
  });
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    assert.equal(body.store, false);
    assert.equal(
      route.request().headers().authorization,
      "Bearer test-key-not-real",
    );
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.reasoning.effort, "low");
    const { paragraphs } = JSON.parse(body.input);
    assert(
      paragraphs.every(
        (p) => typeof p.text === "string" && !p.text.startsWith("data:"),
      ),
    );
    if (mode === "slow") {
      onSlowRequest?.();
      await new Promise((resolve) => {
        slowResolve = resolve;
      });
    }
    if (mode === "auth") {
      await route.fulfill({ status: 401, body: "{}" });
      return;
    }
    const translated = paragraphs.map((p) => ({
      id: p.id,
      text: p.text.includes("Go now")
        ? "나는 지금 바로 가라고 말한다."
        : p.text.includes("Chapter")
          ? "정원의 아침"
          : p.text.includes("Second")
            ? "둘째 쪽"
            : p.text.includes("Third")
              ? "셋째 쪽"
              : p.text.includes("quiet garden")
                ? "조용한 정원에 아침 햇살이 가득했다. 작은 새가 오래된 나무 문 옆에서 기다렸다."
                : "제목",
    }));
    if (
      body.instructions.startsWith(
        "Translate every current paragraph into Japanese.",
      )
    )
      translated.forEach((p) => {
        p.text = "日本語の翻訳です。";
      });
    if (mode === "missing") translated.pop();
    if (mode === "overflow")
      translated.forEach((p) => {
        p.text = "아주 긴 번역문입니다. ".repeat(200);
      });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ paragraphs: translated }),
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
      body: '<!doctype html><html><head><title>Kindle fixture</title><style>body{margin:20px;background:#e9ece7}.kg-full-page-img img{width:1000px;height:700px}button{margin:6px}</style></head><body><div aria-hidden="true"><div class="kg-full-page-img"></div></div></body></html>',
    }),
  );
  const page = await context.newPage();
  await page.goto("https://read.amazon.com/fixture");
  const imagingBundle = await build({
    entryPoints: ["src/imaging.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "imagingTest",
  });
  await page.addScriptTag({ content: imagingBundle.outputFiles[0].text });
  assert.equal(
    await page.evaluate(async () => {
      const source = document.createElement("canvas");
      source.width = source.height = 10;
      const decoded = await imagingTest.decode(source.toDataURL());
      return decoded.getContext("2d").getContextAttributes().willReadFrequently;
    }),
    true,
  );
  const fractionalComposition = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 300, 100);
    context.fillStyle = "black";
    context.font = "20px serif";
    context.fillText("Hello", 24, 45);
    const box = { x0: 20.25, y0: 20, x1: 110.5, y1: 50 };
    return imagingTest.compose(
      canvas,
      [
        {
          id: "fractional",
          text: "Hello",
          box,
          words: [box],
          lines: [box],
          confidence: 99,
          kind: "body",
        },
      ],
      [{ id: "fractional", text: "안녕" }],
    );
  });
  assert.deepEqual(fractionalComposition.skipped, []);
  assert.equal(fractionalComposition.regions.length, 1);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function fixture(label = "Chapter One", replace = false, dark = false) {
    const previousOverlay = (await overlay.count())
      ? await overlay.elementHandle()
      : null;
    await page.evaluate(
      ({ label, replace, dark }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 700;
        const c = canvas.getContext("2d");
        c.fillStyle = dark ? "#202020" : "#ffffff";
        c.fillRect(0, 0, 1000, 700);
        c.fillStyle = dark ? "#eeeeee" : "#111111";
        c.font = "bold 36px serif";
        c.fillText(label, 60, 80);
        c.font = "28px serif";
        c.fillText("The quiet garden was full of morning light.", 60, 160);
        c.fillText("A small bird waited beside the old wooden gate.", 60, 200);
        c.fillStyle = "#397868";
        c.fillRect(100, 330, 300, 200);
        c.fillStyle = "#f1c45b";
        c.beginPath();
        c.arc(250, 430, 65, 0, Math.PI * 2);
        c.fill();
        const container = document.querySelector(".kg-full-page-img");
        let img = container.querySelector("img");
        if (!img || replace) {
          img = document.createElement("img");
          container.replaceChildren(img);
        }
        img.src = canvas.toDataURL();
      },
      { label, replace, dark },
    );
    if (previousOverlay) {
      await page.waitForFunction(
        (root) => !root.isConnected || root.hasAttribute("data-kw-held"),
        previousOverlay,
        { timeout: 3000 },
      );
      await previousOverlay.dispose();
    }
  }
  const status = page.locator("#kw-reader-controls").getByRole("status");
  const overlay = page.locator("[data-kw-overlay]:not([data-kw-held])");
  async function translated() {
    await overlay.waitFor({ state: "visible", timeout: 90000 });
    await status
      .locator(':scope[data-state="ready"]')
      .waitFor({ timeout: 5000 });
  }
  await fixture();
  await translated();
  assert(requests.length === 1);
  assert.deepEqual(JSON.parse(requests[0].input).previous_page, []);
  await page.keyboard.press("Alt+Shift+KeyT");
  await overlay.waitFor({ state: "hidden" });
  await page.keyboard.press("Alt+Shift+KeyT");
  await overlay.waitFor({ state: "visible" });
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "shortcut-test";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("Alt+Shift+KeyT");
  assert.equal(await overlay.isVisible(), true);
  await page.locator("#shortcut-test").evaluate((input) => input.remove());
  assert(
    JSON.parse(requests[0].input).paragraphs.some((p) =>
      p.text.includes("quiet garden"),
    ),
  );
  const comparison = await page.evaluate(async () => {
    const original = document.querySelector(".kg-full-page-img img"),
      result = document
        .querySelector("[data-kw-overlay]")
        .shadowRoot.querySelector("img");
    await result.decode();
    function pixels(image) {
      const c = document.createElement("canvas");
      c.width = 1000;
      c.height = 700;
      const x = c.getContext("2d");
      x.drawImage(image, 0, 0);
      return x.getImageData(100, 330, 300, 200).data;
    }
    const a = pixels(original),
      b = pixels(result);
    return {
      equal: a.every((v, i) => v === b[i]),
      pointer: getComputedStyle(result).pointerEvents,
    };
  });
  assert.equal(comparison.equal, true);
  assert.equal(comparison.pointer, "none");
  await page.screenshot({ path: "artifacts/integration-translated.png" });
  await page.getByRole("button", { name: "원문 보기", exact: true }).click();
  assert.equal(await overlay.isVisible(), false);
  await page.getByRole("button", { name: "번역 보기", exact: true }).click();
  assert.equal(await overlay.isVisible(), true);
  await fixture("Second Page");
  await overlay.waitFor({ state: "detached", timeout: 3000 });
  await fixture("Third Page", true);
  await translated();
  assert(
    JSON.parse(requests.at(-1).input).paragraphs.some((p) =>
      p.text.includes("Third"),
    ),
  );
  const thirdSource = await overlay.locator("img").getAttribute("src");
  await fixture();
  await translated();
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].input).previous_page, []);
  const beforeTextReuse = requests.length;
  await fixture("Chapter One", true, true);
  await translated();
  assert.equal(requests.length, beforeTextReuse);
  const textReuse = JSON.parse(
    await page.locator("#kw-reader-controls").getAttribute("data-kw-cache"),
  )
    .filter((event) => event.event === "timing")
    .at(-1);
  assert.equal(textReuse.ocrCacheHit, 0);
  assert.equal(textReuse.textCacheHit, 1);
  await page.setViewportSize({ width: 900, height: 800 });
  assert.equal(
    await overlay.evaluate((e) => e.getBoundingClientRect().width),
    1000,
  );
  await fixture("Dark Chapter", true, true);
  await translated();
  mode = "missing";
  await fixture("Missing Response");
  await overlay.waitFor({ state: "detached", timeout: 3000 });
  await status.locator(':scope[title*="누락"]').waitFor({ timeout: 90000 });
  assert.equal(await overlay.count(), 0);
  mode = "auth";
  await page.getByRole("button", { name: "재시도", exact: true }).click();
  await status.locator(':scope[title*="401"]').waitFor({ timeout: 90000 });
  assert.equal(await overlay.count(), 0);
  mode = "overflow";
  await page.getByRole("button", { name: "재시도", exact: true }).click();
  await status
    .locator(':scope[title*="원문을 유지"]')
    .waitFor({ timeout: 90000 });
  mode = "slow";
  await fixture("Delayed Page");
  await overlay.waitFor({ state: "detached", timeout: 3000 });
  await status.locator(':scope[title*="번역하고"]').waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "번역 끄기", exact: true }).click();
  slowResolve?.();
  mode = "success";
  await status.locator(':scope[title*="꺼져"]').waitFor({ timeout: 5000 });
  assert.equal(await overlay.count(), 0);
  await page.getByRole("button", { name: "번역 켜기", exact: true }).click();
  await page.getByRole("button", { name: "번역 끄기", exact: true }).waitFor();
  await translated();
  await fixture("Third Page");
  await translated();
  assert.equal(await overlay.locator("img").getAttribute("src"), thirdSource);
  const countBeforeHidden = requests.length;
  await page.evaluate(() => {
    document.querySelector(".kg-full-page-img").style.display = "none";
  });
  await overlay.waitFor({ state: "detached", timeout: 3000 });
  await fixture("Hidden Page");
  await page.waitForTimeout(1500);
  assert.equal(requests.length, countBeforeHidden);
  const source = await page
    .locator(".kg-full-page-img img")
    .getAttribute("src");
  const dual = await context.newPage();
  await dual.goto("https://read.amazon.com/dual");
  await dual.evaluate((source) => {
    const container = document.querySelector(".kg-full-page-img");
    container.style.display = "flex";
    for (let i = 0; i < 2; i++) {
      const image = document.createElement("img");
      image.src = source;
      image.style.width = "500px";
      image.style.height = "350px";
      container.append(image);
    }
  }, source);
  await dual.waitForFunction(
    () => document.querySelectorAll("[data-kw-overlay]").length === 2,
    {},
    { timeout: 90000 },
  );
  const rectangles = await dual
    .locator("[data-kw-overlay]")
    .evaluateAll((images) =>
      images.map((image) => ({
        x: image.getBoundingClientRect().x,
        width: image.getBoundingClientRect().width,
      })),
    );
  assert.deepEqual(rectangles, [
    { x: 20, width: 500 },
    { x: 520, width: 500 },
  ]);
  await dual.close();
  const framed = await context.newPage();
  await framed.goto("https://read.amazon.com/framed");
  await framed.evaluate(() => {
    document.body.innerHTML =
      '<iframe src="https://read.amazon.com/inner" style="width:1050px;height:760px;border:0"></iframe>';
  });
  const frame = await (await framed.waitForSelector("iframe")).contentFrame();
  await frame.waitForSelector(".kg-full-page-img", { state: "attached" });
  await frame.evaluate((source) => {
    const img = document.createElement("img");
    img.src = source;
    document.querySelector(".kg-full-page-img").append(img);
  }, source);
  await frame
    .locator("[data-kw-overlay]")
    .waitFor({ state: "visible", timeout: 90000 });
  const beforeHiddenFrame = requests.length;
  await framed.locator("iframe").evaluate((e) => {
    e.style.display = "none";
  });
  await frame
    .locator("[data-kw-overlay]")
    .waitFor({ state: "detached", timeout: 3000 });
  await frame.locator(".kg-full-page-img img").evaluate((e) => {
    e.src += "";
  });
  await framed.waitForTimeout(1500);
  assert.equal(requests.length, beforeHiddenFrame);
  await framed.close();
  const spread = await context.newPage();
  await spread.goto("https://read.amazon.com/spread");
  const spreadRequest = requests.length;
  await spread.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 1100;
    const c = canvas.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#111";
    c.font = "32px serif";
    for (const [side, x] of [
      ["Left", 70],
      ["Right", 1070],
    ]) {
      for (let paragraph = 0; paragraph < 3; paragraph++) {
        const y = 90 + paragraph * 240;
        c.fillText(
          `${side} page: The quiet garden was full of morning light.`,
          x + 30,
          y,
        );
        c.fillText(
          "A small bird waited beside the old wooden gate.",
          x,
          y + 50,
        );
        c.fillText(
          "The sun was rising over the fields and the garden.",
          x,
          y + 100,
        );
      }
      c.fillText("Go now.", x + 30, 850);
    }
    const image = document.createElement("img");
    image.src = canvas.toDataURL();
    image.style.width = "1000px";
    image.style.height = "550px";
    image.style.objectFit = "contain";
    document.querySelector(".kg-full-page-img").append(image);
  });
  const spreadOverlay = spread.locator("[data-kw-overlay]");
  await spreadOverlay.waitFor({ state: "visible", timeout: 90000 });
  const spreadParagraphs = requests
    .slice(spreadRequest)
    .flatMap((request) => JSON.parse(request.input).paragraphs);
  assert(spreadParagraphs.some((p) => p.text.includes("Left page")));
  assert(spreadParagraphs.some((p) => p.text.includes("Right page")));
  assert(
    spreadParagraphs.every(
      (p) => !(p.text.includes("Left page") && p.text.includes("Right page")),
    ),
  );
  const geometry = await spreadOverlay.evaluate((root) => {
    const paragraphs = [...root.shadowRoot.querySelectorAll("p")];
    return paragraphs.map((p) => ({
      x: parseFloat(p.style.left),
      width: parseFloat(p.style.width),
      fontSize: parseFloat(p.querySelector("span").style.fontSize),
      short: p.textContent.includes("나는 지금 바로 가라고 말한다."),
    }));
  });
  assert(geometry.length >= 6);
  assert.deepEqual(
    JSON.parse(await spreadOverlay.getAttribute("data-kw-diagnostics")),
    [],
  );
  const shortTranslations = spreadOverlay
    .locator("p")
    .filter({ hasText: "나는 지금 바로 가라고 말한다." });
  assert.equal(await shortTranslations.count(), 2);
  assert(
    await shortTranslations
      .first()
      .evaluate((p) => parseFloat(p.style.width) > 500),
  );
  assert(geometry.some((p) => p.x < 1000));
  assert(geometry.some((p) => p.x > 1000));
  assert(
    geometry.every((p) =>
      p.x < 1000 ? p.x + p.width < 1000 : p.x + p.width < 2000,
    ),
  );
  assert(
    geometry.every(
      (p) => p.fontSize >= (p.short ? 22 : 26) && p.fontSize <= 36,
    ),
  );
  const firstLine = spreadOverlay.locator("p span").first();
  const lineBox = await firstLine.boundingBox();
  await spread.mouse.move(lineBox.x + 1, lineBox.y + lineBox.height / 2);
  await spread.mouse.down();
  await spread.mouse.move(
    lineBox.x + lineBox.width - 1,
    lineBox.y + lineBox.height / 2,
    { steps: 12 },
  );
  await spread.mouse.up();
  const selected = await spread.evaluate(() =>
    window.getSelection().toString(),
  );
  assert(selected.includes("정원"));
  await spread.screenshot({
    path: "artifacts/integration-spread-selected.png",
  });
  await spread.close();
  await page.bringToFront();
  await page.evaluate(() => {
    history.pushState({}, "", "?asin=OTHER-BOOK");
    document.querySelector(".kg-full-page-img").style.display = "block";
  });
  await fixture("Different Book", true);
  await translated();
  assert.deepEqual(JSON.parse(requests.at(-1).input).previous_page, []);
  const blank = await context.newPage();
  await blank.goto("https://read.amazon.com/blank");
  await blank.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 700;
    const x = c.getContext("2d");
    x.fillStyle = "white";
    x.fillRect(0, 0, 1000, 700);
    const image = document.createElement("img");
    image.src = c.toDataURL();
    document.querySelector(".kg-full-page-img").append(image);
  });
  await blank
    .locator("#kw-reader-controls")
    .getByRole("status")
    .locator(':scope[title*="인식하지 못했습니다"]')
    .waitFor({ timeout: 90000 });
  assert.equal(await blank.locator("[data-kw-overlay]").count(), 0);
  await blank.close();
  await page.bringToFront();
  const options = await context.newPage();
  await options.goto(
    `chrome-extension://${new URL(sw.url()).host}/options.html`,
  );
  assert.equal(await options.locator("#cache-pages").inputValue(), "5");
  await options.locator("#cache-pages").fill("10");
  await options.getByRole("button", { name: "설정 저장", exact: true }).click();
  await options.locator("#status").filter({ hasText: "캐시 10개" }).waitFor();
  assert.equal(
    await sw.evaluate(
      async () => (await chrome.storage.local.get("cachePages")).cachePages,
    ),
    10,
  );
  await options.reload();
  await options.waitForFunction(
    () => document.querySelector("#cache-pages").value === "10",
  );
  await options.locator("#cache-pages").fill("2");
  for (const family of ["serif", "sans-serif"]) {
    const sizes = [];
    for (const scale of [70, 100]) {
      const beforeAppearance = requests.length;
      await options.locator("#font-family").selectOption(family);
      await options.locator("#font-scale").fill(String(scale));
      await options
        .getByRole("button", { name: "설정 저장", exact: true })
        .click();
      await options
        .locator("#status")
        .filter({ hasText: "저장했습니다" })
        .waitFor();
      await overlay.waitFor({ state: "detached" });
      await page.bringToFront();
      await translated();
      assert.equal(requests.length, beforeAppearance);
      const appearanceTiming = JSON.parse(
        await page.locator("#kw-reader-controls").getAttribute("data-kw-cache"),
      )
        .filter((event) => event.event === "timing")
        .at(-1);
      assert.equal(appearanceTiming.ocrCacheHit, 1);
      assert.equal(appearanceTiming.translationCacheHit, 1);
      const rendered = await overlay.evaluate((root) => {
        const line = root.shadowRoot.querySelector("p span");
        return {
          size: parseFloat(line.style.fontSize),
          family: getComputedStyle(line).fontFamily,
          loaded: [...document.fonts]
            .filter((f) => f.status === "loaded")
            .map((f) => f.family.replaceAll('"', "")),
        };
      });
      const expected =
        family === "serif" ? "KW Nanum Myeongjo" : "KW Nanum Gothic";
      assert(rendered.family.includes(expected));
      assert(rendered.loaded.includes(expected), JSON.stringify(rendered));
      sizes.push(rendered.size);
      await options.bringToFront();
    }
    assert(
      sizes[0] < sizes[1],
      `${family} size control must change actual text size`,
    );
  }
  assert.equal(await options.locator("#source-language").inputValue(), "en");
  assert.equal(await options.locator("#target-language").inputValue(), "ko");
  for (const language of ["ja", "ko"]) {
    await options.locator("#target-language").selectOption(language);
    await options
      .getByRole("button", { name: "설정 저장", exact: true })
      .click();
    await options
      .getByRole("status")
      .filter({ hasText: "저장했습니다" })
      .waitFor();
    await page.bringToFront();
    await page
      .locator(`[data-kw-overlay][lang="${language}"]`)
      .waitFor({ state: "attached", timeout: 90000 });
    await translated();
    const languageTiming = JSON.parse(
      await page.locator("#kw-reader-controls").getAttribute("data-kw-cache"),
    )
      .filter((event) => event.event === "timing")
      .at(-1);
    if (!languageTiming.translationCacheHit)
      assert(
        requests
          .at(-1)
          .instructions.startsWith(
            `Translate every current paragraph into ${language === "ja" ? "Japanese" : "Korean"}.`,
          ),
      );
    assert.equal(
      JSON.parse(
        await page.locator("#kw-reader-controls").getAttribute("data-kw-cache"),
      )
        .filter((event) => event.event === "timing")
        .at(-1).ocrCacheHit,
      1,
    );
    assert.deepEqual(JSON.parse(requests.at(-1).input).previous_page, []);
    assert.equal(
      await sw.evaluate(
        async () =>
          (await chrome.storage.local.get("targetLanguage")).targetLanguage,
      ),
      language,
    );
    if (language === "ja")
      assert(
        (await overlay.locator("[data-kw-sheet]").innerText()).includes(
          "日本語",
        ),
      );
    await options.bringToFront();
  }
  await options.close();
  assert.equal(
    await sw.evaluate(
      async () => (await chrome.storage.local.get("cachePages")).cachePages,
    ),
    2,
  );
  await page.bringToFront();
  await translated();
  const viewer = page.locator("#kw-reader-controls");
  assert.equal(
    await viewer.getByLabel("원본 언어", { exact: true }).inputValue(),
    "en",
  );
  assert.equal(
    await viewer.getByLabel("번역할 언어", { exact: true }).inputValue(),
    "ko",
  );
  for (const source of ["fr", "en"]) {
    const before = requests.length;
    await viewer.getByLabel("원본 언어", { exact: true }).selectOption(source);
    await overlay.waitFor({ state: "detached", timeout: 5000 });
    await translated();
    assert.equal(requests.length, before + (source === "fr" ? 1 : 0));
    const sourceTiming = JSON.parse(await viewer.getAttribute("data-kw-cache"))
      .filter((event) => event.event === "timing")
      .at(-1);
    assert.equal(sourceTiming.ocrCacheHit, source === "en" ? 1 : 0);
    assert.equal(sourceTiming.translationCacheHit, source === "en" ? 1 : 0);
    if (source === "fr")
      assert(
        requests
          .at(-1)
          .instructions.includes(
            `The source language is ${source === "fr" ? "French" : "English"}.`,
          ),
      );
    assert.equal(
      await sw.evaluate(
        async () =>
          (await chrome.storage.local.get("sourceLanguage")).sourceLanguage,
      ),
      source,
    );
    assert.deepEqual(JSON.parse(requests.at(-1).input).previous_page, []);
  }
  for (const target of ["ja", "ko"]) {
    await viewer
      .getByLabel("번역할 언어", { exact: true })
      .selectOption(target);
    await page
      .locator(`[data-kw-overlay][lang="${target}"]`)
      .waitFor({ state: "attached", timeout: 90000 });
    await translated();
    assert.equal(
      await sw.evaluate(
        async () =>
          (await chrome.storage.local.get("targetLanguage")).targetLanguage,
      ),
      target,
    );
  }
  await page.screenshot({ path: "artifacts/integration-viewer-languages.png" });
  await page.evaluate(() => {
    const footer = document.createElement("footer");
    footer.id = "fixture-location";
    footer.textContent = "Location 96 of 508";
    document.body.append(footer);
    for (const direction of ["Previous", "Next"]) {
      const button = document.createElement("button");
      button.setAttribute("aria-label", `${direction} page`);
      button.textContent = direction;
      document.body.append(button);
    }
  });
  await page.waitForTimeout(1300);
  await translated();
  const priorText = await overlay.locator("[data-kw-sheet]").innerText();
  const priorSource = await page
    .locator(".kg-full-page-img img")
    .getAttribute("src");
  await page
    .getByRole("button", {
      name: "이전 페이지 보기",
      exact: true,
      pressed: false,
    })
    .click();
  await page
    .getByRole("button", {
      name: "이전 페이지 보기",
      exact: true,
      pressed: true,
    })
    .waitFor();
  await translated();
  await page.evaluate(() => {
    window.flashFrames = [];
    window.monitorFlashes = true;
    const sample = () => {
      if (!window.monitorFlashes) return;
      const covered = [...document.querySelectorAll("[data-kw-overlay]")].some(
        (e) => {
          const rect = e.getBoundingClientRect();
          return (
            getComputedStyle(e).display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        },
      );
      window.flashFrames.push(covered);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  mode = "slow";
  const slowStarted = new Promise((resolve) => {
    onSlowRequest = resolve;
  });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 105 of 508";
  });
  await fixture("Second Page", true);
  await slowStarted;
  await overlay.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await overlay.locator("[data-kw-sheet]").innerText(), priorText);
  assert.equal(await status.locator("#page-label").innerText(), "이전 페이지");
  assert.equal(await status.locator(".spinner").isVisible(), true);
  assert.equal(
    await status.locator(".spinner").getAttribute("aria-label"),
    "번역 중",
  );
  await page.getByRole("button", { name: "원문 보기", exact: true }).click();
  const originalLayer = overlay.locator("[data-kw-original]");
  assert.equal(await originalLayer.isVisible(), true);
  assert.equal(await originalLayer.getAttribute("src"), priorSource);
  assert.equal(
    await overlay.locator("[data-kw-background]").isVisible(),
    false,
  );
  assert.equal(await overlay.locator("p").first().isVisible(), false);
  await page.keyboard.press("Alt+Shift+T");
  assert.equal(await originalLayer.isVisible(), false);
  assert.equal(await overlay.locator("p").first().isVisible(), true);
  const buttonTops = await page
    .locator("#kw-reader-controls button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().top),
    );
  assert.equal(buttonTops.length, 4);
  assert.equal(new Set(buttonTops).size, 1);
  mode = "success";
  onSlowRequest = undefined;
  slowResolve();
  await status
    .locator(':scope[data-state="ready"]')
    .waitFor({ timeout: 90000 });
  assert.equal(await overlay.locator("[data-kw-sheet]").innerText(), priorText);
  assert.equal(await status.innerText(), "이전 페이지");
  assert.equal(await status.locator(".indicator").isVisible(), false);
  await page.screenshot({ path: "artifacts/integration-compact-controls.png" });
  const beforeThird = requests.length;
  await page.getByRole("button", { name: "Next page", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 114 of 508";
  });
  await fixture("Third Page", true);
  await status
    .locator(':scope[data-state="ready"]')
    .waitFor({ timeout: 90000 });
  assert(
    (await overlay.locator("[data-kw-sheet]").innerText()).includes("둘째 쪽"),
  );
  assert.equal(requests.length, beforeThird + 1);
  assert.equal(await overlay.getAttribute("data-kw-location"), "105");
  await page.screenshot({ path: "artifacts/integration-previous-page.png" });
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .focus();
  await page.keyboard.press("ArrowLeft");
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 105 of 508";
  });
  await fixture("Second Page", true);
  await translated();
  assert(
    (await overlay.locator("[data-kw-sheet]").innerText()).includes("둘째 쪽"),
  );
  assert(
    !(await overlay.locator("[data-kw-sheet]").innerText()).includes("셋째 쪽"),
  );
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 114 of 508";
  });
  await fixture("Third Page", true);
  await translated();
  assert.equal(await overlay.getAttribute("data-kw-location"), "105");
  const flashFrames = await page.evaluate(() => {
    window.monitorFlashes = false;
    return window.flashFrames;
  });
  assert(flashFrames.length > 10);
  assert(
    flashFrames.every(Boolean),
    "a frame exposed the current original during navigation",
  );

  await page
    .getByRole("button", {
      name: "이전 페이지 보기",
      exact: true,
      pressed: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "이전 페이지 보기",
      exact: true,
      pressed: false,
    })
    .waitFor();
  await translated();
  assert(
    (await overlay.locator("[data-kw-sheet]").innerText()).includes("셋째 쪽"),
  );
  assert.equal(requests.length, beforeThird + 1);
  await fixture("Second Page", true);
  await translated();
  assert.equal(requests.length, beforeThird + 1);
  await fixture("Different Book", true);
  await translated();
  assert.equal(requests.length, beforeThird + 2);
  await page
    .getByRole("button", {
      name: "이전 페이지 보기",
      exact: true,
      pressed: false,
    })
    .click();
  await translated();
  mode = "slow";
  const pendingPrevious = new Promise((resolve) => {
    onSlowRequest = resolve;
  });
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 200 of 508";
  });
  await fixture("Pending Previous", true);
  await pendingPrevious;
  const releasePrevious = slowResolve;
  const pendingPreviousRetry = new Promise((resolve) => {
    onSlowRequest = resolve;
  });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 210 of 508";
  });
  await fixture("Pending Next", true);
  await overlay.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await overlay.getAttribute("data-kw-location"), "200");
  assert.equal(await overlay.locator("p").count(), 0);
  assert.equal(await overlay.locator("[data-kw-original]").count(), 1);
  await pendingPreviousRetry;
  mode = "success";
  onSlowRequest = undefined;
  slowResolve?.();
  releasePrevious?.();
  await status
    .locator(':scope[data-state="ready"]')
    .waitFor({ timeout: 90000 });
  assert((await overlay.locator("p").count()) > 0);
  assert.equal(await overlay.getAttribute("data-kw-location"), "200");
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ enabled: false, cachePages: 10 });
  });
  await status.locator(':scope[data-state="idle"]').waitFor();
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 1000 of 2000";
  });
  await fixture("First Page", true);
  const sequenceStart = requests.length;
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ enabled: true });
  });
  await translated();
  assert.equal(requests.length - sequenceStart, 1);
  const firstTranslation = await overlay.locator("[data-kw-sheet]").innerText();
  const sequenceSources = new Map([
    [1, await page.locator(".kg-full-page-img img").getAttribute("src")],
  ]);
  const sequenceResults = [
    { current: 1, displayed: 1, translationRequests: 1 },
  ];
  const sequence = [
    {
      current: 2,
      displayed: 1,
      requests: 2,
      key: "ArrowRight",
      label: "Second Page",
    },
    {
      current: 3,
      displayed: 2,
      requests: 3,
      key: "ArrowRight",
      label: "Third Page",
    },
    {
      current: 2,
      displayed: 1,
      requests: 3,
      key: "ArrowLeft",
      label: "Second Page",
    },
    {
      current: 3,
      displayed: 2,
      requests: 3,
      key: "ArrowRight",
      label: "Third Page",
    },
    {
      current: 4,
      displayed: 3,
      requests: 4,
      key: "ArrowRight",
      label: "Fourth Page",
    },
  ];
  for (const step of sequence) {
    await page.getByRole("button", { name: "Next page", exact: true }).focus();
    await page.keyboard.press(step.key);
    await page.locator("#fixture-location").evaluate((e, current) => {
      e.textContent = `Location ${990 + current * 10} of 2000`;
    }, step.current);
    await fixture(step.label, true);
    sequenceSources.set(
      step.current,
      await page.locator(".kg-full-page-img img").getAttribute("src"),
    );
    await translated();
    assert.equal(
      await overlay.getAttribute("data-kw-location"),
      String(990 + step.displayed * 10),
    );
    assert.equal(
      await overlay.getAttribute("data-kw-current-location"),
      String(990 + step.current * 10),
    );
    assert.equal(
      await overlay.locator("[data-kw-original]").getAttribute("src"),
      sequenceSources.get(step.displayed),
    );
    const displayedText = await overlay.locator("[data-kw-sheet]").innerText();
    if (step.displayed === 1) assert.equal(displayedText, firstTranslation);
    else
      assert(
        displayedText.includes(step.displayed === 2 ? "둘째 쪽" : "셋째 쪽"),
      );
    assert.equal(requests.length - sequenceStart, step.requests);
    if (step.current === step.requests) {
      const context = JSON.parse(requests.at(-1).input).previous_page;
      const expectedSource = {
        2: "First Page",
        3: "Second Page",
        4: "Third Page",
      }[step.current];
      assert(context.some((pair) => pair.source.includes(expectedSource)));
      assert(!context.some((pair) => pair.source.includes(step.label)));
    }
    const fastTrace = JSON.parse(
      await page.locator("#kw-reader-controls").getAttribute("data-kw-cache"),
    );
    const preview = fastTrace.findLast(
      (event) =>
        event.event === "preview" && event.location === 990 + step.current * 10,
    );
    const verified = fastTrace.findLast(
      (event) =>
        event.event === "previous" &&
        event.location === 990 + step.current * 10,
    );
    assert(
      preview,
      "cached screen should be displayed before stable processing",
    );
    assert.equal(preview.previous, 990 + step.displayed * 10);
    assert(preview.time <= verified.time);
    sequenceResults.push({
      current: step.current,
      displayed: step.displayed,
      translationRequests: requests.length - sequenceStart,
    });
  }
  await writeFile(
    "artifacts/page-sequence-report.json",
    JSON.stringify(
      {
        passed: true,
        cachePages: 10,
        realOCR: true,
        mockedTranslationAPI: true,
        steps: sequenceResults,
      },
      null,
      2,
    ),
  );
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ enabled: false, cachePages: 1 });
  });
  await status.locator(':scope[data-state="idle"]').waitFor();
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 2000 of 3000";
  });
  await fixture("First Page", true);
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ enabled: true });
  });
  await translated();
  const protectedText = await overlay.locator("[data-kw-sheet]").innerText();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.locator("#fixture-location").evaluate((e) => {
    e.textContent = "Location 2010 of 3000";
  });
  await fixture("Second Page", true);
  await translated();
  assert.equal(await overlay.getAttribute("data-kw-location"), "2000");
  assert.equal(
    await overlay.locator("[data-kw-sheet]").innerText(),
    protectedText,
  );
  const protectedTrace = JSON.parse(
    await page.locator("#kw-reader-controls").getAttribute("data-kw-cache"),
  );
  assert.equal(protectedTrace.at(-1).limit, 1);
  assert.equal(protectedTrace.at(-1).size, 2);
  assert.deepEqual(errors, []);
  const disconnectedPage = await context.newPage();
  const disconnectedErrors = [];
  disconnectedPage.on("pageerror", (error) =>
    disconnectedErrors.push(error.message),
  );
  await disconnectedPage.goto("about:blank");
  await disconnectedPage.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 700;
    const image = new Image();
    image.src = canvas.toDataURL();
    await image.decode();
    const container = document.createElement("div");
    container.className = "kg-full-page-img";
    container.append(image);
    document.body.append(container);
    window.sendAttempts = 0;
    window.chrome = {
      runtime: {
        connect: () => ({
          postMessage() {
            window.sendAttempts++;
            throw new Error("Extension context invalidated.");
          },
          onMessage: { addListener() {} },
          onDisconnect: { addListener() {} },
        }),
      },
    };
  });
  const contentBundle = await build({
    entryPoints: ["src/content.ts"],
    bundle: true,
    write: false,
    format: "iife",
  });
  await disconnectedPage.addScriptTag({
    content: contentBundle.outputFiles[0].text,
  });
  await disconnectedPage
    .locator("#kw-reader-controls #view")
    .evaluate((button) => button.click());
  await disconnectedPage
    .locator("#kw-reader-controls #disable")
    .evaluate((button) => button.click());
  assert.match(
    await disconnectedPage
      .locator("#kw-reader-controls")
      .evaluate((node) => node.shadowRoot.querySelector("[role=status]").title),
    /새로고침/,
  );
  assert.equal(await disconnectedPage.evaluate(() => window.sendAttempts), 1);
  assert.deepEqual(disconnectedErrors, []);
  await disconnectedPage.close();
  const report = {
    passed: true,
    apiRequests: requests.length,
    checks: [
      "real extension OCR and composition",
      "visible image under aria-hidden ancestor",
      "complete text submitted",
      "illustration pixels unchanged",
      "original/translation toggle and Alt+Shift+T",
      "gpt-6-luna model and previous page bilingual context",
      "shortcut ignored in input and book change clears context",
      "single image spread retains both pages and source-sized selectable HTML text",
      "short paragraphs use blank column width without shrinking or skipping",
      "rapid A-B-C navigation",
      "replaced image element",
      "cache revisit",
      "viewport resize",
      "dark background",
      "missing paragraphs rejected",
      "authentication failure",
      "overflow preserves original",
      "disable during API request",
      "reenable",
      "hidden page no requests",
      "two visible pages aligned",
      "same-origin iframe OCR and overlay",
      "hidden iframe no requests",
      "empty OCR preserves original",
      "fractional native coordinates preserve raster background detection",
      "options persist both bundled Nanum fonts and change actual text size",
      "target language persists, changes API instructions and rendered language, and clears old context/cache",
      "viewer source and target selectors persist immediately and retranslate with the selected OCR language",
      "reader controls previous-page toggle shows cached text before current API response and retains it after completion",
      "turning previous-page mode off restores cached current translation without API call",
      "previous-page original toggle preserves the displayed page and all four controls share one row",
      "every sampled frame stays covered during forward and backward previous-page navigation",
      "unfinished previous page displays its cached original before replacing it with translation",
      "configurable cache defaults to five; two-page limit reuses recent and evicts oldest",
    ],
    realOpenAI: false,
    realKindleTranslation: false,
  };
  await writeFile(
    "artifacts/integration-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  for (const page of context.pages())
    for (const frame of page.frames())
      console.error(
        frame.url(),
        await frame
          .locator("#kw-reader-controls")
          .getByRole("status")
          .allTextContents(),
        await frame
          .locator("#kw-reader-controls")
          .evaluateAll((roots) =>
            roots.map((root) => root.getAttribute("data-kw-cache")),
          ),
      );
  throw error;
} finally {
  slowResolve?.();
  await context.close();
}
