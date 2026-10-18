import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareTranslator,
  translate,
  translationChunks,
  type TranslatorFactory,
} from "../src/translation.ts";
import type { Paragraph } from "../src/model.ts";

test("local translation preserves paragraph order, chunks long inputs, and reports progress", async () => {
  const calls: string[] = [];
  const progress: number[] = [];
  const paragraphs = [
    "First\n paragraph.",
    "A long sentence. ".repeat(200),
  ].map((text, i) => ({ id: `p${i}`, text }) as Paragraph);
  const result = await translate(
    paragraphs,
    {
      async translate(text) {
        calls.push(text);
        return `번역 ${text}`;
      },
      destroy() {},
    },
    new AbortController().signal,
    (completed) => progress.push(completed),
  );
  assert.deepEqual(
    result.map(({ id }) => id),
    ["p0", "p1"],
  );
  assert.equal(calls[0], "First paragraph.");
  assert(calls.every((text) => text.length <= 1000));
  assert.deepEqual(progress, [1, 2]);
  assert.equal(
    translationChunks(paragraphs[1].text).join(" "),
    paragraphs[1].text.trim(),
  );
  assert.equal(
    translationChunks("😀".repeat(1000)).join(""),
    "😀".repeat(1000),
  );
});

test("cancellation prevents subsequent local translation and empty output fails", async () => {
  const controller = new AbortController();
  let calls = 0;
  const paragraphs = [
    { id: "a", text: "first" },
    { id: "b", text: "second" },
  ] as Paragraph[];
  await assert.rejects(
    translate(
      paragraphs,
      {
        async translate() {
          calls++;
          controller.abort();
          return "late";
        },
        destroy() {},
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    translate(
      paragraphs,
      {
        async translate() {
          return "";
        },
        destroy() {},
      },
      new AbortController().signal,
    ),
    /비어/,
  );
});

test("feature detection, download progress, failures and late cancellation stay local", async () => {
  const scope = globalThis as typeof globalThis & {
    Translator?: TranslatorFactory;
  };
  const original = scope.Translator;
  let destroyed = 0;
  let created = 0;
  const controller = new AbortController();
  const messages: string[] = [];
  try {
    delete scope.Translator;
    await assert.rejects(
      prepareTranslator(controller.signal, () => {}),
      /지원하지/,
    );
    scope.Translator = {
      async availability() {
        return "unavailable";
      },
      async create() {
        created++;
        throw new Error("Must not run");
      },
    };
    await assert.rejects(
      prepareTranslator(controller.signal, () => {}),
      /지원하지/,
    );
    assert.equal(created, 0);
    scope.Translator = {
      async availability(pair) {
        assert.deepEqual(pair, { sourceLanguage: "en", targetLanguage: "ko" });
        return "downloadable";
      },
      async create(options) {
        options.monitor({
          addEventListener(_type, listener) {
            listener({ loaded: 0.5 });
          },
        });
        return {
          async translate() {
            return "local";
          },
          destroy() {
            destroyed++;
          },
        };
      },
    };
    const translator = await prepareTranslator(controller.signal, (message) =>
      messages.push(message),
    );
    assert(messages.some((message) => message.includes("50%")));
    translator.destroy();
    const create = scope.Translator.create;
    scope.Translator.create = async (options) => {
      controller.abort();
      return create(options);
    };
    await assert.rejects(
      prepareTranslator(controller.signal, () => {}),
      { name: "AbortError" },
    );
    assert.equal(destroyed, 2);
    scope.Translator.create = async () => {
      throw new Error("Download failed");
    };
    await assert.rejects(
      prepareTranslator(new AbortController().signal, () => {}),
      /Download failed/,
    );
  } finally {
    if (original) scope.Translator = original;
    else delete scope.Translator;
  }
});
