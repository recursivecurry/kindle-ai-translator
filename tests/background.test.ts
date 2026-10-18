import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

test("toolbar action uses onClicked for activeTab and explicitly opens its window's panel", async () => {
  const bundle = await build({
    entryPoints: ["src/background.ts"],
    bundle: true,
    write: false,
    format: "iife",
  });
  let click: ((tab: { windowId: number }) => void) | undefined;
  let automaticOpening: boolean | undefined;
  const openedWindows: number[] = [];
  const errors: string[] = [];
  let fail = false;
  runInNewContext(bundle.outputFiles[0].text, {
    chrome: {
      runtime: { onInstalled: { addListener() {} } },
      action: {
        onClicked: {
          addListener(listener: typeof click) {
            click = listener;
          },
        },
      },
      sidePanel: {
        async setPanelBehavior({
          openPanelOnActionClick,
        }: {
          openPanelOnActionClick: boolean;
        }) {
          automaticOpening = openPanelOnActionClick;
        },
        async open({ windowId }: { windowId: number }) {
          if (fail) throw new Error("private third-party details");
          openedWindows.push(windowId);
        },
      },
    },
    console: { error: (message: string) => errors.push(message) },
  });
  assert.equal(automaticOpening, false);
  assert(click);
  click({ windowId: 7 });
  assert.deepEqual(openedWindows, [7]);
  fail = true;
  click({ windowId: 8 });
  await Promise.resolve();
  assert.deepEqual(errors, ["Could not open the translation panel."]);
});
