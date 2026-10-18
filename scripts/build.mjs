import { TARGET_LANGUAGES } from "../src/languages.ts";
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/vendor", { recursive: true });
await cp("public", "dist", { recursive: true });
await cp("README.md", "dist/README.md");
await cp("README.ko.md", "dist/README.ko.md");
await cp("DESIGN.md", "dist/DESIGN.md");
await cp("DESIGN.ko.md", "dist/DESIGN.ko.md");
await cp("docs/images", "dist/docs/images", { recursive: true });
await build({
  entryPoints: [
    "src/background.ts",
    "src/content.ts",
    "src/kindle-bridge.ts",
    "src/offscreen.ts",
    "src/options.ts",
  ],
  bundle: true,
  outdir: "dist",
  target: "chrome116",
  format: "iife",
});
await cp(
  "node_modules/tesseract.js/dist/worker.min.js",
  "dist/vendor/worker.min.js",
);
await mkdir("dist/vendor/core");
for (const file of [
  "LICENSE",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
]) {
  await cp(
    `node_modules/tesseract.js-core/${file}`,
    `dist/vendor/core/${file}`,
  );
}
for (const { ocr } of Object.values(TARGET_LANGUAGES)) {
  await cp(
    `node_modules/@tesseract.js-data/${ocr}/4.0.0_best_int/${ocr}.traineddata.gz`,
    `dist/vendor/${ocr}.traineddata.gz`,
  );
}
await cp(
  "node_modules/tesseract.js/LICENSE.md",
  "dist/vendor/TESSERACT-LICENSE",
);
await cp(
  "node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt",
  "dist/vendor/worker.min.js.LICENSE.txt",
);
