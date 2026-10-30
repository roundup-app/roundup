import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4698d");

it("u4698d_worst_case_todo_keeps_its_actions_reachable", { retry: 0, timeout: 90_000 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");

  if (output) { mkdirSync(output, { recursive: true }); await browser("record", "start", join(output, "todo.webm")); await browser("wait", ".shelf-tabs"); await browser("set", "media", "dark"); }

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
    writeFileSync(join(output, "metadata.json"), JSON.stringify({ sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), title, blockers: 30, owner: null, seed: "tree-40", viewports: [[1512,950],[1280,820]], scheme: "dark" }, null, 2));
  }

  for (const [width, height] of [[1512,950],[1280,820]]) {
    await browser("set", "viewport", String(width), String(height));
    await settle();
    expect(await evaluate("document.querySelector('.todo-detail-title').textContent.trim()")).toBe(title);

    if (output) {
      await browser("screenshot", join(output, `open-${width}.png`));
      writeFileSync(join(output, `open-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    }

    if (await evaluate("!!document.querySelector('.todo-header')")) {
      await browser("click", '.drawer [aria-label="More actions"]');
      await browser("wait", '[role="menu"][data-state="open"]');

      if (output) await browser("screenshot", join(output, `actions-${width}.png`));
      await browser("press", "Escape");
      await browser("wait", ".todo-header");
      await browser("click", 'button:has-text("Blocked by")');
      await browser("wait", '[role="combobox"]');

      if (output) await browser("screenshot", join(output, `blockers-${width}.png`));
      await browser("press", "Escape");
    }

    await evaluate("window.__fake.app.rpc('todo.complete', { id: 1 }); true");
    await browser("wait", '.drawer input[type="checkbox"]:checked');

    if (output) await browser("screenshot", join(output, `done-${width}.png`));
    await browser("click", '.drawer [aria-label="Restore"]');
    await settle();

    if (output) await browser("screenshot", join(output, `minimised-${width}.png`));
    await browser("click", '.drawer [aria-label="Maximise"]');
    await settle();
    await evaluate("window.__fake.app.rpc('todo.reopen', { id: 1 }); true");
    await browser("wait", '.drawer input[type="checkbox"]:not(:checked)');
  }

  if (output) await browser("record", "stop");
});
