import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4698d");

const title = "UnbrokenTitle".repeat(16).slice(0, 200);

const openDocument = async (width: number, height: number, recording = false) => {
  await openShelf("tree-40", 288, 320, 1512, "dark");

  if (output && recording) {
    mkdirSync(output, { recursive: true });
    await browser("record", "start", join(output, `todo-${width}.webm`));
    await browser("wait", ".shelf-tabs");
    // Recording starts a fresh browser context; restore the requested media there.
    await browser("set", "media", "dark");
  }

  await evaluate(`(async () => {
    const app = window.__fake.app;
    const ids = [];
    for (let i = 0; i < 30; i++) ids.push((await app.rpc('todo.create', { title: 'Review dependency ' + i, body: '', blockers: null })).id);
    await app.rpc('todo.update', { id: 1, title: ${JSON.stringify(title)}, body: ${JSON.stringify("# Release plan\n\n| Task | Result |\n| --- | --- |\n| " + "LongUnbrokenCell".repeat(30) + " | Wrap this text |\n\n```text\n" + "UnbrokenCode".repeat(35) + "\n```\n\n" + "A long document retains its original contents and readable failure feedback. ".repeat(150))} });
    const done = await app.rpc('todo.create', { title: 'Completed dependency', body: '', blockers: null });
    await app.rpc('todo.complete', { id: done.id });
    await app.rpc('todo.setBlockers', { id: 1, blockers: [...ids, done.id] });
    await app.rpc('todo.create', { title: 'Open dependent', body: '', blockers: [1] });
    const dependent = await app.rpc('todo.create', { title: 'Completed dependent', body: '', blockers: [1] });
    await app.rpc('todo.complete', { id: dependent.id });
    await app.rpc('todo.assign', { id: 1, owner: null });
    const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", '[data-todo="1"] .todo-row-button');
  await browser("focus", '[data-todo="1"] .todo-row-button');
  await browser("press", "Enter");
  await browser("wait", ".todo-detail-title");
  await browser("wait", ".drawer .ProseMirror");
  await settle();

  await browser("set", "viewport", String(width), String(height));
  await settle();
};

it.each([[1512, 950], [1280, 820]])("u4698d_worst_case_todo_keeps_its_actions_reachable_%sx%s", { retry: 0, timeout: 90_000 }, async (width, height) => {
  await openDocument(width, height, true);

  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, `metadata-${width}.json`), JSON.stringify({ sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), title, blockers: 30, owner: null, seed: "tree-40", viewport: [width, height], scheme: "dark" }, null, 2));
  }

  {
    await browser("set", "viewport", String(width), String(height));
    await settle();


    if (output) {
      await browser("screenshot", join(output, `open-${width}.png`));
      writeFileSync(join(output, `open-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));

    }

    if (await evaluate("!!document.querySelector('.todo-header')")) {
      await browser("click", '.drawer [aria-label="More actions"]');
      await browser("wait", '[role="menu"][data-state="open"]');

      if (output) {
        await browser("screenshot", join(output, `actions-${width}.png`));
        writeFileSync(join(output, `actions-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
      }

      await browser("press", "Escape");
      await browser("wait", ".todo-header");
      await browser("click", '[aria-label="Blocked by 30"]');
      await browser("wait", '[role="combobox"]');

      if (output) {
        await browser("screenshot", join(output, `blockers-${width}.png`));
        writeFileSync(join(output, `blockers-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
      }

      await browser("press", "Escape");
    }

    await evaluate("window.__fake.app.rpc('todo.complete', { id: 1 }); true");
    await browser("wait", '.drawer input[type="checkbox"]:checked');

    if (output) {
      await browser("screenshot", join(output, `done-${width}.png`));
      writeFileSync(join(output, `done-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    }

    await browser("click", '.drawer [aria-label="Restore"]');
    await settle();

    if (output) {
      await browser("screenshot", join(output, `minimised-${width}.png`));
      writeFileSync(join(output, `minimised-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    }

    await browser("click", '.drawer [aria-label="Maximise"]');
    await settle();


    await evaluate("window.__fake.app.rpc('todo.reopen', { id: 1 }); true");
    await browser("wait", '.drawer input[type="checkbox"]:not(:checked)');
  }

  if (output) {
    await evaluate("(() => { const pane = document.querySelector('.todo-detail'); pane.scrollTop = pane.scrollHeight; return true; })()");
    await settle();
    await browser("screenshot", join(output, `bottom-${width}.png`));
    writeFileSync(join(output, `bottom-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  }

  if (output) await browser("record", "stop");

  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'todo.complete' && call.params.id === 1).map(call => call.params.id)")).toEqual([1]);

});

it.each([[1512, 950], [1280, 820]])("u4698d_rich_body_saves_the_selected_todo_and_keeps_a_refused_draft_%sx%s", { retry: 0, timeout: 90_000 }, async (width, height) => {
  await openDocument(width, height);
  await browser("click", ".drawer .ProseMirror");
  await browser("wait", '.drawer .todo-detail-body .word');
  await browser("focus", '.drawer .ProseMirror');
  await browser("press", "Control+A");
  await browser("press", "Backspace");
  await settle();
  await browser("type", '.drawer .ProseMirror', "Exact body retained after refusal");
  await evaluate(`(() => { window.__fake.failNext(-32003, 'Body could not be saved. Retry with the original work intact.'); return true; })()`);
  await browser("press", "Control+Enter");
  await browser("wait", '.todo-detail-body [role="alert"]');

  if (output) {
    await browser("screenshot", join(output, `body-refusal-${width}.png`));
    writeFileSync(join(output, `body-refusal-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  }

  await browser("focus", '.drawer .ProseMirror');
  await browser("wait", "--fn", "document.activeElement === document.querySelector('.drawer .ProseMirror') && [...document.querySelectorAll('.todo-detail-body button')].some(button => button.textContent === 'Save')");
  await browser("press", "Control+Enter");
  await browser("wait", '.drawer .todo-detail-body .ProseMirror');
  expect(await evaluate(`window.__fake.app.calls.filter(call => call.method === 'todo.update' && call.params.body?.startsWith('Exact body')).map(call => ({ id: call.params.id, body: call.params.body }))`)).toEqual([
    { id: 1, body: "Exact body retained after refusal" },
  ]);
});

it.each([[1512, 950], [1280, 820]])("u4698d_refused_actions_keep_the_dense_document_recoverable_%sx%s", { retry: 0, timeout: 90_000 }, async (width, height) => {
  await openDocument(width, height);
  const capture = async (name: string, failure?: string) => {
    if (failure) await browser("wait", "--fn", `document.querySelector('.drawer [role="alert"]')?.textContent.includes(${JSON.stringify(failure)})`);
    await settle();

    if (output) {
      await browser("screenshot", join(output, `${name}-${width}.png`));
      writeFileSync(join(output, `${name}-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    }
  };

  await browser("dblclick", ".todo-detail-title p");
  await browser("wait", '.todo-detail-title textarea');
  await capture("title-editing");
  await browser("fill", '.todo-detail-title textarea', title + " retained");
  await evaluate("window.__fake.failNext(-32003, 'Title could not be saved. Keep this draft and retry.'); true");
  await browser("press", "Enter");
  await capture("title-refusal", "Title could not be saved");
  await browser("focus", '.todo-detail-title textarea');
  await browser("press", "Escape");
  await browser("wait", '.todo-detail-title p');

  await browser("click", '.todo-meta [aria-label="Priority"]');
  await browser("wait", '[role="menu"][data-state="open"]');
  await capture("priority-menu");
  await evaluate("window.__fake.failNext(-32003, 'Priority could not be saved. Choose a priority to retry.'); true");
  await browser("click", '[role="menuitem"][data-value="urgent"]');
  await capture("priority-refusal", "Priority could not be saved");
  await browser("click", '.todo-delete-feedback [data-dismiss-failure]');

  await browser("click", '[aria-label="Blocking 1"]');
  await browser("wait", '[role="combobox"]');
  await capture("blocking-menu");
  await evaluate(`(() => { window.__fake.app.handlers['todo.setBlockers'] = () => { throw new Error('Dependency could not be saved. Keep this choice and retry.'); }; return true; })()`);
  await browser("fill", '[role="combobox"]', 'todo 2');
  await browser("wait", '[role="option"]');
  await browser("press", "Enter");
  await capture("relation-refusal", "Dependency could not be saved");
  await browser("click", '.todo-delete-feedback [data-dismiss-failure]');

  await browser("click", '.drawer [aria-label="More actions"]');
  await browser("wait", '[role="menu"][data-state="open"]');
  await evaluate("window.__fake.failNext(-32003, 'Todo could not be deleted. Keep your work and retry deletion.'); true");
  await browser("click", '[role="menuitem"][data-value="delete"]');
  await capture("delete-refusal", "Todo could not be deleted");
  expect(await evaluate("!!document.querySelector('.drawer .todo-detail-title')")).toBe(true);
});
