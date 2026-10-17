import {
  targetLanguage,
  sourceLanguage,
  TARGET_LANGUAGES,
} from "../src/languages.ts";
import { PageHistory } from "../src/page-history.ts";
import {
  translationTextKey,
  translationBatches,
} from "../src/translation-plan.ts";
import { translate } from "../src/translation.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTranslations,
  wrapText,
  deadline,
  type Paragraph,
  boundedContext,
  CONTEXT_CHARACTERS,
  typography,
  cachePageLimit,
} from "../src/model.ts";
import { pageRegions, imagePlacement } from "../src/layout.ts";
import { compose } from "../src/imaging.ts";
import {
  validateWordBoxes,
  refineParagraphCoordinates,
} from "../src/kindle-coordinates.ts";
test("parallel requests preserve original paragraph text, IDs and Location context", async () => {
  const originalFetch = globalThis.fetch;
  const paragraphs = [
    "How AI Was Used to",
    "Make This Book",
    "A human-\nmade work. ".repeat(30),
  ].map((text, i): Paragraph => ({
    id: `p${i}`,
    text,
    kind: "body",
    confidence: 99,
    words: [],
    lines: [],
    box: { x0: 0, x1: 100, y0: i * 40, y1: i * 40 + 20 },
  }));
  const context = [{ source: "Previous", translation: "앞 문맥" }];
  let calls = 0;
  const submitted: Paragraph[] = [];
  globalThis.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(String(options?.body));
    const input = JSON.parse(body.input);
    assert.equal(body.reasoning.effort, "low");
    assert.deepEqual(input.previous_page, context);
    submitted.push(...input.paragraphs);
    assert.equal(input.current_page_source, undefined);
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  paragraphs: input.paragraphs.map((p: Paragraph) => ({
                    id: p.id,
                    text: "번역 " + p.id,
                  })),
                }),
              },
            ],
          },
        ],
      }),
    );
  };
  try {
    const result = await translate(
      paragraphs,
      "test-key",
      new AbortController().signal,
      context,
    );
    assert.equal(calls, 2);
    assert.deepEqual(
      submitted.map((p) => [p.id, p.text]),
      paragraphs.map((p) => [p.id, p.text]),
    );
    assert.deepEqual(translationBatches(paragraphs).flat(), paragraphs);
    assert.equal(translationBatches(paragraphs.slice(0, 2)).length, 1);
    const connectedSentence = [
      { ...paragraphs[0], text: "A long opening clause, ".repeat(20) },
      { ...paragraphs[1], text: "and its ending." },
      { ...paragraphs[2], text: "Another complete paragraph." },
    ];
    const batches = translationBatches(connectedSentence);
    assert.deepEqual(batches[0], connectedSentence.slice(0, 2));
    assert.deepEqual(batches.flat(), connectedSentence);
    assert.deepEqual(
      result.map((p) => p.id),
      paragraphs.map((p) => p.id),
    );
    const key = translationTextKey("book", "en", "ko", paragraphs, context);
    const moved = paragraphs.map((p) => ({
      ...p,
      id: "new-" + p.id,
      box: { ...p.box, x0: 50 },
    }));
    assert.equal(translationTextKey("book", "en", "ko", moved, context), key);
    assert.notEqual(
      translationTextKey("book", "en", "ko", paragraphs, []),
      key,
    );
    assert.notEqual(
      translationTextKey("book", "en", "ja", paragraphs, context),
      key,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parallel failure cancels the outstanding request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let cancelled = false;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1)
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            { content: [{ type: "output_text", text: '{"paragraphs":[]}' }] },
          ],
        }),
      );
    return new Promise((_resolve, reject) => {
      options!.signal!.addEventListener(
        "abort",
        () => {
          cancelled = true;
          reject(new Error("Cancelled"));
        },
        { once: true },
      );
    });
  };
  try {
    const paragraphs = [0, 1].map((i): Paragraph => ({
      id: `p${i}`,
      text: "A complete sentence. ".repeat(20),
      kind: "body",
      confidence: 99,
      words: [],
      lines: [],
      box: { x0: 0, x1: 100, y0: i * 200, y1: i * 200 + 100 },
    }));
    await assert.rejects(
      translate(paragraphs, "test-key", new AbortController().signal),
      /누락/,
    );
    assert.equal(calls, 2);
    assert(cancelled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("native coordinates refine matching paragraph edges and preserve OCR on unavailable or mismatched data", () => {
  const p: Paragraph = {
    id: "p0",
    text: "word",
    box: { x0: 12, y0: 20, x1: 48, y1: 40 },
    words: [{ x0: 12, y0: 20, x1: 48, y1: 40 }],
    lines: [{ x0: 12, y0: 20, x1: 48, y1: 40 }],
    confidence: 99,
    kind: "body",
    page: { x0: 0, y0: 0, x1: 100, y1: 100 },
  };
  const original = structuredClone(p);
  assert.equal(refineParagraphCoordinates([p], []), 0);
  assert.deepEqual(p, original);
  assert.equal(
    refineParagraphCoordinates([p], [{ x0: 60, y0: 20, x1: 90, y1: 40 }]),
    0,
  );
  assert.deepEqual(p, original);
  const boxes = validateWordBoxes(
    [{ x0: 10, y0: 16, x1: 50, y1: 43 }],
    100,
    100,
  );
  assert.equal(refineParagraphCoordinates([p], boxes), 1);
  assert.deepEqual(p.box, { x0: 10, y0: 20, x1: 50, y1: 40 });
  assert.equal(p.text, original.text);
  assert.deepEqual(p.lines, [p.box]);
  const mixed = structuredClone(original);
  const unmatched = { x0: 70, y0: 20, x1: 90, y1: 40 };
  mixed.words.push(unmatched);
  mixed.box.x1 = 90;
  mixed.lines[0].x1 = 90;
  assert.equal(refineParagraphCoordinates([mixed], boxes), 1);
  assert.equal(mixed.words[0].x0, 10);
  assert.deepEqual(mixed.words[1], unmatched);
  assert.equal(mixed.box.x1, 90);
  assert.deepEqual(
    validateWordBoxes([{ x0: 0, y0: 0, x1: 101, y1: 20 }], 100, 100),
    [],
  );
  assert.deepEqual(
    validateWordBoxes([{ x0: NaN, y0: 0, x1: 20, y1: 20 }], 100, 100),
    [],
  );
  assert.deepEqual(validateWordBoxes(null, 100, 100), []);
});
const paragraphs = [
  { id: "p0", text: "First" },
  { id: "p1", text: "Second" },
] as Paragraph[];
test("typography defaults and bounds stored settings", () => {
  assert.deepEqual(typography(), { family: "sans-serif", scale: 1 });
  assert.deepEqual(typography({ family: "serif", scale: 1.2 }), {
    family: "serif",
    scale: 1.2,
  });
  assert.equal(typography({ scale: Infinity }).scale, 1);
  assert.equal(typography({ scale: 2 }).scale, 1.3);
  assert.equal(typography({ scale: 0 }).scale, 0.7);
});
test("cache page limit defaults to five and validates persisted values", () => {
  assert.equal(cachePageLimit(undefined), 5);
  assert.equal(cachePageLimit(NaN), 5);
  assert.equal(cachePageLimit("10"), 5);
  assert.equal(cachePageLimit(2), 2);
  assert.equal(cachePageLimit(0), 1);
  assert.equal(cachePageLimit(40), 30);
});
test("preserves paragraph order and rejects missing, duplicate, empty, reordered output", () => {
  assert.deepEqual(
    validateTranslations(
      {
        paragraphs: [
          { id: "p0", text: "첫째" },
          { id: "p1", text: "둘째" },
        ],
      },
      paragraphs,
    ),
    [
      { id: "p0", text: "첫째" },
      { id: "p1", text: "둘째" },
    ],
  );
  for (const rows of [
    [],
    [{ id: "p0", text: "첫째" }],
    [
      { id: "p0", text: "첫째" },
      { id: "p0", text: "둘째" },
    ],
    [
      { id: "p1", text: "둘째" },
      { id: "p0", text: "첫째" },
    ],
    [
      { id: "p0", text: "" },
      { id: "p1", text: "둘째" },
    ],
  ])
    assert.throws(() => validateTranslations({ paragraphs: rows }, paragraphs));
});
test("wrap retains every Korean character and explicit paragraph break", () => {
  const text = "번역문을 자르지 않습니다.\n다음 문장";
  const lines = wrapText(text, 6, (t) => [...t].length);
  assert.equal(
    lines.join("").replaceAll(" ", ""),
    text.replaceAll(" ", "").replaceAll("\n", ""),
  );
  assert(lines.every((l) => l.length <= 6));
});
test("context keeps complete bilingual pairs within the bound", () => {
  const recent = { source: "latest", translation: "최근" };
  assert.deepEqual(
    boundedContext([
      { source: "x".repeat(CONTEXT_CHARACTERS), translation: "앞" },
      recent,
    ]),
    [recent],
  );
  assert.deepEqual(boundedContext([{ source: "bad" }]), []);
  assert.deepEqual(boundedContext(null), []);
});
test("composition preserves indent, line spacing and centered lines without drawing overflow", () => {
  const context = {
    canvas: { width: 400, height: 300 },
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    }),
    font: "20px sans-serif",
    measureText(text: string) {
      const size = parseFloat(this.font);
      return {
        width: text.length * size * 0.5,
        actualBoundingBoxAscent: size * 0.6,
        actualBoundingBoxDescent: size * 0.2,
        fontBoundingBoxAscent: size * 0.8,
        fontBoundingBoxDescent: size * 0.2,
      };
    },
    fillRect: () => {},
  };
  const canvas = {
    getContext: () => context,
    toDataURL: () => "image",
  } as unknown as HTMLCanvasElement;
  const paragraph: Paragraph = {
    id: "p",
    text: "first\nsecond",
    box: { x0: 20, y0: 20, x1: 220, y1: 80 },
    lines: [
      { x0: 50, y0: 20, x1: 220, y1: 40 },
      { x0: 20, y0: 60, x1: 220, y1: 80 },
    ],
    words: [],
    confidence: 99,
    kind: "body",
  };
  const result = compose(
    canvas,
    [paragraph],
    [{ id: "p", text: "첫 줄\n둘째 줄" }],
  );
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(
    result.regions[0].runs.map((run) => run.x),
    [50, 20],
  );
  assert.equal(result.regions[0].runs[1].y - result.regions[0].runs[0].y, 40);
  assert.equal(result.regions[0].runs[0].fontSize, 25);
  paragraph.lines[0] = { x0: 50, y0: 20, x1: 190, y1: 40 };
  const centered = compose(
    canvas,
    [paragraph],
    [{ id: "p", text: "가나\n다라" }],
  );
  assert.deepEqual(
    centered.regions[0].runs.map((run) => run.x),
    [107.5, 107.5],
  );
  paragraph.lines[0] = { x0: 20, y0: 20, x1: 220, y1: 40 };
  const justified = compose(
    canvas,
    [paragraph],
    [{ id: "p", text: "가나\n다라" }],
  );
  assert.deepEqual(
    justified.regions[0].runs.map((run) => run.x),
    [20, 20],
  );
  const overflow = compose(
    canvas,
    [paragraph],
    [{ id: "p", text: "긴".repeat(1000) }],
  );
  assert.deepEqual(overflow.skipped, ["p"]);
  assert.equal(overflow.regions.length, 0);
  const page = { x0: 0, y0: 0, x1: 400, y1: 300 };
  const short: Paragraph = {
    ...paragraph,
    page,
    box: { x0: 20, y0: 20, x1: 70, y1: 40 },
    lines: [{ x0: 20, y0: 20, x1: 70, y1: 40 }],
  };
  const next: Paragraph = {
    ...paragraph,
    id: "next",
    page,
    box: { x0: 20, y0: 100, x1: 220, y1: 120 },
    lines: [{ x0: 20, y0: 100, x1: 220, y1: 120 }],
  };
  const expanded = compose(
    canvas,
    [short, next],
    [
      { id: "p", text: "지금 바로 가라고 말한다." },
      { id: "next", text: "다음" },
    ],
  );
  assert.deepEqual(expanded.skipped, []);
  assert.equal(expanded.regions[0].box.x0, 20);
  assert.equal(expanded.regions[0].box.x1, 220);
  assert.equal(expanded.regions[0].runs[0].fontSize, 25);
  let inkX = 53;
  let connected = false;
  context.getImageData = (x, y, width, height) => {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const index = ((35 - y) * width + inkX - x) * 4;
    if (inkX >= x && inkX < x + width && 35 >= y && 35 < y + height)
      data.fill(0, index, index + 3);
    if (connected)
      for (let col = 50; col <= inkX; col++) {
        const offset = ((35 - y) * width + col - x) * 4;
        if (col >= x && col < x + width && 35 >= y && 35 < y + height)
          data.fill(0, offset, offset + 3);
      }
    return { data };
  };
  paragraph.words = [{ x0: 20, y0: 20, x1: 50, y1: 60 }];
  assert.deepEqual(
    compose(canvas, [paragraph], [{ id: "p", text: "글자" }]).skipped,
    [],
  );
  inkX = 80;
  assert.deepEqual(
    compose(canvas, [paragraph], [{ id: "p", text: "글자" }]).skipped,
    ["p"],
  );
  connected = true;
  inkX = 65;
  assert.deepEqual(
    compose(canvas, [paragraph], [{ id: "p", text: "글자" }]).skipped,
    [],
  );
  inkX = 150;
  assert.deepEqual(
    compose(canvas, [paragraph], [{ id: "p", text: "글자" }]).skipped,
    ["p"],
  );
});
test("pending work has bounded time and propagates original errors", async () => {
  const controller = new AbortController();
  const cancelled = deadline(
    new Promise(() => {}),
    1000,
    "timeout",
    controller.signal,
  );
  controller.abort();
  await assert.rejects(cancelled, /취소/);
  await assert.rejects(
    deadline(new Promise(() => {}), 10, "timeout"),
    /timeout/,
  );
  await assert.rejects(
    deadline(Promise.reject(new Error("decode failed")), 50, "timeout"),
    /decode failed/,
  );
  assert.equal(await deadline(Promise.resolve(7), 50, "timeout"), 7);
});

test("spread detection preserves a gutter without splitting single-page text", () => {
  const width = 1000,
    height = 600;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (left: number, right: number) => {
    for (let y = 40; y < 500; y += 30)
      for (let x = left; x < right; x++)
        for (let channel = 0; channel < 3; channel++)
          pixels[(y * width + x) * 4 + channel] = 0;
  };
  ink(40, 460);
  ink(540, 960);
  assert.deepEqual(pageRegions(width, height, pixels), [
    { x0: 0, y0: 0, x1: 500, y1: 600 },
    { x0: 500, y0: 0, x1: 1000, y1: 600 },
  ]);
  ink(460, 540);
  assert.equal(pageRegions(width, height, pixels).length, 1);
  assert.equal(
    pageRegions(width, height, new Uint8ClampedArray(pixels.length).fill(255))
      .length,
    1,
  );
});
test("image placement follows object-fit and object-position", () => {
  assert.deepEqual(
    imagePlacement(2000, 1000, 1000, 600, "contain", "50% 50%"),
    { scaleX: 0.5, scaleY: 0.5, x: 0, y: 50 },
  );
  assert.deepEqual(imagePlacement(2000, 1000, 1000, 600, "cover", "50% 0%"), {
    scaleX: 0.6,
    scaleY: 0.6,
    x: -100,
    y: 0,
  });
  assert.deepEqual(imagePlacement(2000, 1000, 1000, 600, "fill", "50% 50%"), {
    scaleX: 0.5,
    scaleY: 0.6,
    x: 0,
    y: 0,
  });
});

test("book predecessors survive backward turns and reject jumps or unknown locations", () => {
  const history = new PageHistory();
  history.record(96, ["a"]);
  history.navigate(96, 1);
  history.record(105, ["b"]);
  history.navigate(105, 1);
  history.record(114, ["c"]);
  assert.deepEqual(history.previous(114), {
    location: 105,
    keys: ["b"],
    layout: "",
  });
  history.navigate(114, -1);
  history.record(105, ["b"]);
  assert.deepEqual(history.previous(105), {
    location: 96,
    keys: ["a"],
    layout: "",
  });
  history.record(200, ["jump"]);
  assert.equal(history.previous(200), undefined);
  assert.equal(history.previous(undefined), undefined);
  history.navigate(200, 1);
  history.navigate(200, 1);
  history.record(230, ["rapid"]);
  assert.equal(history.previous(230), undefined);
  history.record(105, ["new-layout"]);
  assert.equal(history.previous(105), undefined);
});

test("location previews require known navigation and retain layout for validation", () => {
  const history = new PageHistory();
  history.record(96, ["a"], "layout-a");
  assert.equal(history.previewPrevious(105), undefined);
  history.navigate(96, 1);
  assert.deepEqual(history.previewPrevious(105), {
    location: 96,
    keys: ["a"],
    layout: "layout-a",
  });
  assert.equal(history.previewPrevious(96), undefined);
  history.record(105, ["b"], "layout-a");
  history.navigate(105, 1);
  history.record(114, ["c"], "layout-a");
  history.navigate(114, -1);
  assert.equal(history.previewPrevious(105)?.location, 96);
  history.record(105, ["b"], "layout-b");
  assert.equal(history.previewPrevious(105), undefined);
});

test("target language defaults to Korean and only accepts supported languages", () => {
  for (const language of Object.keys(TARGET_LANGUAGES))
    assert.equal(targetLanguage(language), language);
  for (const invalid of [
    undefined,
    null,
    "",
    "unknown",
    "__proto__",
    "constructor",
  ])
    assert.equal(targetLanguage(invalid), "ko");
});

test("source language defaults to English and has a matching OCR model", () => {
  for (const invalid of [undefined, null, "unknown", "constructor"])
    assert.equal(sourceLanguage(invalid), "en");
  assert.equal(sourceLanguage("ja"), "ja");
  assert.equal(TARGET_LANGUAGES[sourceLanguage("ja")].ocr, "jpn");
  assert.equal(TARGET_LANGUAGES[sourceLanguage("ko")].ocr, "kor");
});

test("OCR cancellation prevents submission after initialization, image conversion, or recognition", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const bundle = await build({
    entryPoints: ["src/imaging.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "imaging",
    plugins: [
      {
        name: "controlled-ocr-worker",
        setup(build) {
          build.onResolve({ filter: /^tesseract\.js$/ }, () => ({
            path: "worker",
            namespace: "test",
          }));
          build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const createWorker = async () => globalThis.worker;",
          }));
        },
      },
    ],
  });
  for (const stage of ["initialization", "conversion", "recognition"]) {
    let cancelled = false;
    let submitted = 0;
    const sandbox = {
      performance,
      chrome: { runtime: { getURL: (path: string) => path } },
      setTimeout,
      clearTimeout,
      Uint8Array,
      worker: {
        recognize: async (bytes: unknown) => {
          assert(bytes instanceof Uint8Array);
          submitted++;
          if (stage === "recognition") cancelled = true;
          return { data: { blocks: [] } };
        },
      },
      document: {
        createElement: () => ({
          getContext: () => ({ drawImage() {} }),
          toBlob: (callback: (blob: Blob) => void) => {
            if (stage === "conversion") cancelled = true;
            callback(new Blob(["encoded image"]));
          },
        }),
      },
    };
    const imaging = runInNewContext(
      `${bundle.outputFiles[0].text}; imaging`,
      sandbox,
    );
    const canvas = {
      width: 100,
      height: 100,
      getContext: () => ({
        getImageData: () => ({
          data: new Uint8ClampedArray(100 * 100 * 4).fill(255),
        }),
      }),
    };
    await assert.rejects(
      imaging.recognize(
        canvas,
        () => {
          if (stage === "initialization") cancelled = true;
        },
        "en",
        () => {
          if (cancelled) throw new Error("cancelled");
        },
      ),
      /cancelled/,
    );
    assert.equal(submitted, stage === "recognition" ? 1 : 0);
  }
});

test("parallel OCR preserves reading order and coordinates when the right page finishes first", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const bundle = await build({
    entryPoints: ["src/imaging.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "imaging",
    plugins: [
      {
        name: "two-page-ocr",
        setup(build) {
          build.onResolve(
            { filter: /^(tesseract\.js|\.\/layout)$/ },
            ({ path }) => ({ path, namespace: "test" }),
          );
          build.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
            contents:
              path === "tesseract.js"
                ? "export const createWorker = () => { throw Error('unexpected worker'); };"
                : "export const pageRegions = () => [{x0:0,y0:0,x1:100,y1:100},{x0:100,y0:0,x1:200,y1:100}];",
          }));
        },
      },
    ],
  });
  const imaging = runInNewContext(`${bundle.outputFiles[0].text}; imaging`, {
    performance,
    setTimeout,
    clearTimeout,
    Uint8Array,
    document: {
      createElement: () => {
        let offset = 0;
        return {
          getContext: () => ({
            drawImage: (_canvas: unknown, x: number) => {
              offset = x;
            },
          }),
          toBlob: (callback: (blob: Blob) => void) =>
            callback(new Blob([new Uint8Array([offset])])),
        };
      },
    },
  });
  const canvas = {
    width: 200,
    height: 100,
    getContext: () => ({
      getImageData: () => ({ data: new Uint8ClampedArray(80000) }),
    }),
  };
  const output = (bytes: Uint8Array) => {
    const bbox = { x0: 10, y0: 10, x1: 40, y1: 20 };
    return {
      data: {
        blocks: [
          {
            paragraphs: [
              {
                confidence: 99,
                lines: [
                  {
                    text: bytes[0] ? "Right" : "Left",
                    bbox,
                    words: [{ bbox }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
  };
  let finishLeft: (() => void) | undefined;
  let rightFinished = false;
  const workers = [
    Promise.resolve({
      recognize: (bytes: Uint8Array) =>
        new Promise((resolve) => {
          finishLeft = () => resolve(output(bytes));
        }),
    }),
    Promise.resolve({
      recognize: async (bytes: Uint8Array) => {
        assert(finishLeft, "left page must already be in flight");
        rightFinished = true;
        queueMicrotask(() => finishLeft!());
        return output(bytes);
      },
    }),
  ];
  const parallel = await imaging.recognize(
    canvas,
    () => {},
    "en",
    () => {},
    {},
    workers,
  );
  const sequential = await imaging.recognize(
    canvas,
    () => {},
    "en",
    () => {},
    {},
    Promise.resolve({ recognize: async (bytes: Uint8Array) => output(bytes) }),
  );
  assert(rightFinished);
  assert.equal(JSON.stringify(parallel), JSON.stringify(sequential));
  assert.deepEqual(
    Array.from(parallel, (p: Paragraph) => [p.id, p.text, p.box.x0]),
    [
      ["p0", "Left", 10],
      ["p1", "Right", 110],
    ],
  );
});

test("offscreen reuses idle workers and discards cancelled or different-language workers", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const bundle = await build({
    entryPoints: ["src/offscreen.ts"],
    bundle: true,
    write: false,
    format: "iife",
    plugins: [
      {
        name: "controlled-imaging",
        setup(build) {
          build.onResolve({ filter: /^\.\/imaging$/ }, () => ({
            path: "imaging",
            namespace: "test",
          }));
          build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const { decode, recognize, compose, createOcrWorker } = globalThis.imaging;",
          }));
        },
      },
    ],
  });
  let listener: (
    message: object,
    sender: object,
    respond: (result: any) => void,
  ) => void;
  let created = 0,
    terminated = 0;
  let releaseRecognition: (() => void) | undefined;
  let enteredRecognition: (() => void) | undefined;
  let pause = false;
  runInNewContext(bundle.outputFiles[0].text, {
    performance,
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        id: "test",
        onMessage: {
          addListener(value: typeof listener) {
            listener = value;
          },
        },
      },
    },
    imaging: {
      decode: async () => ({ width: 100, height: 100 }),
      createOcrWorker: async () => {
        created++;
        return {
          terminate: async () => {
            terminated++;
          },
        };
      },
      recognize: async (
        _canvas: unknown,
        setWorker: (worker: unknown) => void,
        _language: unknown,
        checkCancelled: () => void,
        _timings: unknown,
        workers: Promise<unknown>[],
      ) => {
        for (const worker of workers) setWorker(await worker);
        checkCancelled();
        if (pause)
          await new Promise<void>((resolve) => {
            releaseRecognition = resolve;
            enteredRecognition?.();
          });
        checkCancelled();
        return [];
      },
      compose() {},
    },
  });
  const request = (id: string, sourceLanguage = "en") =>
    new Promise<any>((resolve) =>
      listener!(
        { target: "offscreen", type: "ocr", id, image: "test", sourceLanguage },
        { id: "test" },
        resolve,
      ),
    );
  assert.equal((await request("one")).timings.workerReused, 0);
  assert.equal((await request("two")).timings.workerReused, 1);
  assert.equal(created, 2);
  assert.equal(terminated, 0);
  pause = true;
  const entered = new Promise<void>((resolve) => {
    enteredRecognition = resolve;
  });
  const cancelled = request("cancelled");
  await entered;
  listener!(
    { target: "offscreen", type: "cancel", id: "cancelled" },
    { id: "test" },
    () => {},
  );
  releaseRecognition!();
  assert.match((await cancelled).error, /취소/);
  pause = false;
  assert.equal((await request("replacement")).timings.workerReused, 0);
  assert.equal(created, 4);
  assert.equal((await request("french", "fr")).timings.workerReused, 0);
  assert.equal(created, 6);
  assert.equal(terminated, 4);
});
