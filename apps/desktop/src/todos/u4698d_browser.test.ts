import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { documentBrowser, output, title } from "./u4698dBrowser";

const { browser, evaluate, settle, openDocument } = documentBrowser();

it.each([[1512, 950, "menus"], [1280, 820, "menus"], [1512, 950, "document"], [1280, 820, "document"]] as const)("u4698d_worst_case_todo_keeps_its_actions_reachable_%sx%s_%s", { retry: 0, timeout: 90_000 }, async (width, height, stage) => {
  await openDocument(width, height, stage === "document");
  await evaluate("window.__fake.app.calls.length = 0; true");

  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, `metadata-${width}.json`), JSON.stringify({ sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), title, blockers: 30, owner: null, seed: "tree-40", viewport: [width, height], scheme: "dark" }, null, 2));
  }

  {
  
    await settle();

    if (output) {
    
      await settle();
      await browser("screenshot", join(output, `open-${width}.png`));
      writeFileSync(join(output, `open-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));

    }

    if (stage === "menus") {
      await browser("click", '.drawer [aria-label="More actions"]');
      await browser("wait", '[role="menu"][data-open]');

      if (output) {
      
      await settle();
      await browser("screenshot", join(output, `actions-${width}.png`));
        writeFileSync(join(output, `actions-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
      }

      await browser("press", "Escape");
      await browser("wait", ".todo-header");
      await browser("click", '[aria-label="Blocked by 30"]');
      await browser("wait", '[role="combobox"]');

      if (output) {
      
      await settle();
      await browser("screenshot", join(output, `blockers-${width}.png`));
        writeFileSync(join(output, `blockers-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
      }

      await browser("press", "Escape");

      for (const action of ["owner", "hand", "home"]) {
          await browser("click", '.drawer [aria-label="More actions"]');
          await browser("wait", '[role="menu"][data-open]');
          await browser("click", `[role="menuitem"][data-value="${action}"]`);
          await settle();
          await browser("wait", '.owner-picker[data-open]');
          await settle();

          if (output) {
            await browser("screenshot", join(output, `${action}-menu-${width}.png`));
            writeFileSync(join(output, `${action}-menu-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
          }

          await browser("press", "Escape");
        }

    }

    if (stage === "menus") {
      expect(await evaluate("window.__fake.app.calls.filter(call => ['todo.update', 'todo.assign', 'todo.move', 'todo.delete'].includes(call.method))")).toEqual([]);

      return;
    }

    if (output) {
      for (const priority of ["low", "medium", "high", "urgent", null]) {
        await evaluate(`window.__fake.app.rpc('todo.update', { id: 1, priority: ${JSON.stringify(priority)} }); true`);
        await settle();
        await browser("screenshot", join(output, `priority-${priority ?? "unset"}-${width}.png`));
        writeFileSync(join(output, `priority-${priority ?? "unset"}-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
      }
    }

    await evaluate("window.__fake.app.rpc('todo.complete', { id: 1 }); true");
    await browser("wait", '.drawer input[type="checkbox"]:checked');

    if (output) {
    
      await settle();
      await browser("screenshot", join(output, `done-${width}.png`));
      writeFileSync(join(output, `done-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    }

    await browser("click", '.drawer [aria-label="Restore"]');
    await settle();

    if (output) {
    
      await settle();
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
  
      await settle();
      await browser("screenshot", join(output, `bottom-${width}.png`));
    writeFileSync(join(output, `bottom-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  }

  if (output) await browser("record", "stop");

  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'todo.complete' && call.params.id === 1).map(call => call.params.id)")).toEqual([1]);

});
