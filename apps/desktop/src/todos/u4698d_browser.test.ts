import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4698d");

it.each([[1512, 950], [1280, 820]])("u4698d_worst_case_todo_keeps_its_actions_reachable_%sx%s", { retry: 0, timeout: 90_000 }, async (width, height) => {
  await openShelf("tree-40", 288, 320, 1512, "dark");

  if (output) { mkdirSync(output, { recursive: true }); await browser("record", "start", join(output, `todo-${width}.webm`)); await browser("wait", ".shelf-tabs"); await browser("set", "media", "dark"); }

  const title = "UnbrokenTitle".repeat(16).slice(0, 200);
  await evaluate(`(async () => {
    const app = window.__fake.app;
    const ids = [];
    for (let i = 0; i < 30; i++) ids.push((await app.rpc('todo.create', { title: 'Review dependency ' + i, body: '', blockers: null })).id);
    await app.rpc('todo.update', { id: 1, title: ${JSON.stringify(title)}, body: ${JSON.stringify("# Release plan\n\n" + "A long document retains its original contents and readable failure feedback. ".repeat(150))} });
    await app.rpc('todo.setBlockers', { id: 1, blockers: ids });
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
  await settle();

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

  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'todo.complete').map(call => call.params.id)")).toEqual([1]);

  if (output) await browser("record", "stop");
});

it("u4698d_rich_body_saves_the_selected_todo_and_keeps_a_refused_draft", { retry: 0, timeout: 90_000 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await evaluate(`(async () => {
    await window.__fake.app.rpc('todo.update', { id: 1, title: 'Release notes', body: '# Plan\\n\\nOriginal body' });
    const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", '[data-todo="1"] .todo-row-button');
  await browser("focus", '[data-todo="1"] .todo-row-button');
  await browser("press", "Enter");
  await browser("wait", ".drawer .ProseMirror");
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
    await browser("screenshot", join(output, "body-refusal.png"));
    writeFileSync(join(output, "body-refusal.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  }

  await browser("focus", '.drawer .ProseMirror');
  await browser("wait", "--fn", "document.activeElement === document.querySelector('.drawer .ProseMirror') && [...document.querySelectorAll('.todo-detail-body button')].some(button => button.textContent === 'Save')");
  await browser("press", "Control+Enter");
  await browser("wait", '.drawer .todo-detail-body .ProseMirror');
  expect(await evaluate(`window.__fake.app.calls.filter(call => call.method === 'todo.update' && call.params.body?.startsWith('Exact body')).map(call => ({ id: call.params.id, body: call.params.body }))`)).toEqual([
    { id: 1, body: "Exact body retained after refusal" },
  ]);
});
