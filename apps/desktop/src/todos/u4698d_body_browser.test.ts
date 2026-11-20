import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { documentBrowser, output } from "./u4698dBrowser";

const { browser, evaluate, settle, openDocument } = documentBrowser();

it.each([[1512, 950], [1280, 820]])("u4698d_rich_body_saves_the_selected_todo_and_keeps_a_refused_draft_%sx%s", { retry: 0, timeout: 90_000 }, async (width, height) => {
  await openDocument(width, height);
  await browser("click", ".drawer .ProseMirror");
  await browser("wait", '.drawer .todo-detail-body .top-bar-item');
  await browser("focus", '.drawer .ProseMirror');
  await browser("press", process.platform === "darwin" ? "Meta+A" : "Control+A");
  await browser("wait", "--fn", "window.getSelection()?.isCollapsed === false");
  // The body saves as it is typed (U7641a): the first save is refused, and the later ones carry the whole text.
  await evaluate(`(() => { window.__fake.failNext(-32003, 'Body could not be saved. Retry with the original work intact.', 'todo.update'); return true; })()`);
  await browser("press", "Backspace");
  await browser("wait", '.app-toast [role="alert"]');

  if (output) {
  
      await settle();
      await browser("screenshot", join(output, `body-refusal-${width}.png`));
    writeFileSync(join(output, `body-refusal-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  }

  await browser("type", '.drawer .ProseMirror', "Exact body retained after refusal");
  await browser("wait", "--fn", "window.__fake.app.calls.some(call => call.method === 'todo.update' && call.params.body === 'Exact body retained after refusal')");
  expect(await evaluate(`window.__fake.app.calls.filter(call => call.method === 'todo.update' && call.params.body === 'Exact body retained after refusal').map(call => ({ id: call.params.id, body: call.params.body }))`)).toEqual([
    { id: 1, body: "Exact body retained after refusal" },
  ]);
});
