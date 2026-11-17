import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { documentBrowser, output, title } from "./u4698dBrowser";

const { browser, evaluate, settle, openDocument } = documentBrowser();

it.each([[1512, 950], [1280, 820]])("u4698d_refused_actions_keep_the_dense_document_recoverable_%sx%s", { retry: 0, timeout: 90_000 }, async (width, height) => {
  await openDocument(width, height);

  const capture = async (name: string, failure?: string) => {
    if (failure) await browser("wait", "--fn", `document.querySelector('.app-toast [role="alert"]')?.textContent.includes(${JSON.stringify(failure)})`);
    await settle();

    if (output) {
    
      await settle();
      await browser("screenshot", join(output, `${name}-${width}.png`));
      writeFileSync(join(output, `${name}-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    }
  };

  await browser("dblclick", ".todo-detail-title p");
  await browser("wait", '.todo-detail-title textarea');
  await capture("title-editing");
  await browser("fill", '.todo-detail-title textarea', title + " retained");
  await evaluate("window.__fake.failNext(-32003, 'Title could not be saved. Keep this draft and retry.', 'todo.update'); true");
  await browser("press", "Enter");
  await capture("title-refusal", "Title could not be saved");
  await browser("focus", '.todo-detail-title textarea');
  await browser("press", "Escape");
  await browser("wait", '.todo-detail-title p');

  await browser("click", '.todo-meta [aria-label="Priority"]');
  await browser("wait", '[role="menu"][data-open]');
  await capture("priority-menu");
  await evaluate("window.__fake.failNext(-32003, 'Priority could not be saved. Choose a priority to retry.', 'todo.update'); true");
  await browser("click", '[role="menuitem"][data-value="urgent"]');
  await capture("priority-refusal", "Priority could not be saved");
  await browser("click", '.app-toast [data-dismiss-failure]');

  await browser("click", '[aria-label="Blocking 1"]');
  await browser("wait", '[role="combobox"]');
  await capture("blocking-menu");
  await evaluate(`(() => { window.__fake.app.handlers['todo.setBlockers'] = () => { throw new Error('Dependency could not be saved. Keep this choice and retry.'); }; return true; })()`);
  await browser("fill", '[role="combobox"]', 'todo 2');
  await browser("wait", '[role="option"]');
  await browser("press", "Enter");
  await capture("relation-refusal", "Dependency could not be saved");
  await browser("click", '.app-toast [data-dismiss-failure]');

  // The Toast region covers the drawer's top corner while a message shows, so the header's menu opens from the page.
  await evaluate("document.querySelector('.drawer [aria-label=\"More actions\"]').click(); true");
  await browser("wait", '[role="menu"][data-open]');
  await evaluate("window.__fake.failNext(-32003, 'Todo could not be deleted. Keep your work and retry deletion.', 'todo.delete'); true");
  await evaluate("document.querySelector('[role=\"menuitem\"][data-value=\"delete\"]').click(); true");
  await capture("delete-refusal", "Todo could not be deleted");
  expect(await evaluate("!!document.querySelector('.drawer .todo-detail-title')")).toBe(true);
});
