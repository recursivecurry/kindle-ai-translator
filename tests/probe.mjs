import { chromium } from "playwright";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${resolve("dist")}`,
    `--load-extension=${resolve("dist")}`,
  ],
});
try {
  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const result = await sw.evaluate(async () => {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS", "BLOBS"],
      justification: "Verify local image decoding and OCR",
    });
    return chrome.runtime.getURL("offscreen.html");
  });
  const page = await context.newPage();
  await page.goto(result.replace("offscreen.html", "options.html"));
  const report = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 700;
    const c = canvas.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, 1000, 700);
    c.fillStyle = "black";
    c.font = "32px serif";
    c.fillText("The quiet garden was full of morning light.", 60, 100);
    c.fillText("A small bird waited beside the old wooden gate.", 60, 150);
    c.fillStyle = "#397868";
    c.fillRect(100, 300, 300, 200);
    const image = canvas.toDataURL();
    const ocr = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "ocr",
      id: "probe",
      image,
    });
    if (ocr.error) throw new Error(ocr.error);
    const output = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "compose",
      id: "probe-compose",
      image,
      paragraphs: ocr.paragraphs,
      translations: ocr.paragraphs.map((p) => ({
        id: p.id,
        text: "조용한 정원에 아침 햇살이 가득했다.",
      })),
    });
    return { paragraphs: ocr.paragraphs, output };
  });
  console.log(
    JSON.stringify({
      ...report,
      output: {
        skipped: report.output.skipped,
        imageBytes: report.output.image?.length,
      },
    }),
  );
  if (!report.output.image || report.output.skipped.length)
    throw new Error("Composition did not succeed");
  await writeFile(
    "artifacts/probe.png",
    Buffer.from(report.output.image.split(",")[1], "base64"),
  );
  await page.screenshot({ path: "artifacts/options.png", fullPage: true });
} finally {
  await context.close();
}
