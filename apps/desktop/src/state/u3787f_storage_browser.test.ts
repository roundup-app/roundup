import { mkdirSync } from "node:fs";
import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

it("u3787f_current_save_failure_rendered_retry", async () => {
  const lane = await openLane(1512, "dark", "u3787f-retention");

  try {
    const origin = await lane.evaluate<string>("location.origin");

    for (const seed of ["tree-40", "tabs-8", "conflict"]) {
      await lane.evaluate("localStorage.clear()");
      await lane.browser("open", `${origin}/harness.html?view=workstreams&items=1&tabs=1&seed=${seed}&todos=worst`);
      await lane.until("!!document.querySelector('[role=tree]')");
      await lane.evaluate("(async () => { const settings = await import('/src/settings/preferences.ts'); await settings.saveAppSettings({ mode: 'dark' }); })()");
      const capture = captureDir("U3787f");

      if (capture) {
        mkdirSync(capture, { recursive: true });
        await lane.browser("record", "start", `${capture}/${seed}-retention-retry.webm`);
      }

      try {
        await lane.browser("set", "media", "dark");
        await lane.until("!!document.querySelector('[role=tree]')");
        await lane.evaluate(`(async () => {
          if (${seed === "conflict"}) return;
          const controls = window.__fake;
          const rpc = controls.app.rpc;
          const tree = await rpc('rail.tree', null);
          const homes = tree.filter(node => node.kind === 'workstream');
          const agent = tree.find(node => node.kind === 'agent');
          const todos = [];
          for (let index = 0; index < 5; index++) {
            todos.push(await rpc('todo.create', { title: '調査と実装 — résumé é 🧭 '.repeat(6), body: null, blockers: null }));
            if (agent) controls.actAs({ kind: 'agent', id: agent.id, parent: null });
            await rpc('pad.create', { name: '調査 résumé 🧭 ' + index, text: null });
            controls.actAs({ kind: 'user', id: 'you', parent: null });
          }
          if (homes.length > 1) {
            await rpc('todo.move', { id: todos[0].id, home: homes[0].id });
            await rpc('todo.move', { id: todos[1].id, home: homes[1].id });
            await rpc('todo.setBlockers', { id: todos[1].id, blockers: [todos[0].id] });
          }
        })()`);
        await lane.capture("U3787f", `head-${seed}-before`);
        await lane.evaluate(`(async () => {
          const original = Storage.prototype.setItem;
          window.__restoreStorage = () => { Storage.prototype.setItem = original; };
          window.__failureCause = "write work.json: disk quota exceeded at /original/調査/résumé — committed records remain available; retry after freeing space";
          window.__failStorage = (prefix = "roundup:") => {
            Storage.prototype.setItem = function(key, value) {
              if (key.startsWith(prefix)) throw new Error(window.__failureCause);
              return original.call(this, key, value);
            };
          };
          window.__failStorage("roundup:rail:");
        })()`);
        await lane.browser("click", "[data-todo-root]");
        await lane.until("!!document.querySelector('.rail-command-notice [role=alert]')");
        // The click returns to Ask (U4453b), whose own draft-retention line is a separate scope (U3791c); the Rail command failure shows once.
        expect(await lane.evaluate<number>("[...document.querySelectorAll('.rail-command-notice [role=alert]')].filter(el => el.textContent.includes(window.__failureCause)).length")).toBe(1);
        await lane.evaluate("window.__restoreStorage()");
        await lane.browser("click", "[data-todo-root]");
        await lane.until("!document.querySelector('.rail-command-notice [role=alert]')");
        await lane.evaluate(`(async () => {
          window.__failStorage();
          const settings = await import('/src/settings/preferences.ts');
          await settings.saveAppSettings({ fontFamily: 'Original font 雪' });
        })()`);
        await lane.browser("click", "#shelf-tab-pads");
        await lane.until("(async () => (await import('/src/state/storage.ts')).storageProblems().length >= 2)()");
        await lane.until("!!document.querySelector('.storage-failure [data-button]')");
        expect(await lane.evaluate<boolean>("document.querySelector('.storage-failure [role=alert]').getAttribute('aria-label').includes(window.__failureCause)")).toBe(true);
        expect(await lane.evaluate<number>("[...document.querySelectorAll('[role=alert]')].filter(el => el.textContent.includes(window.__failureCause)).length")).toBe(1);
        expect(await lane.evaluate<number>("document.querySelectorAll('.storage-failure button').length")).toBe(1);
        await lane.browser("hover", ".storage-failure [role=alert]");
        await lane.until("!!document.querySelector('[role=tooltip]')");
        await lane.capture("U3787f", `head-${seed}-retention-failure`);
        await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
        await lane.until("!!document.querySelector('[role=tab][data-value=Terminal]')");
        await lane.browser("click", "[role=tab][data-value=Terminal]");
        await lane.until("!!document.querySelector('[role=combobox][aria-label=\"Font family\"]')");
        await lane.evaluate("window.__restoreStorage()");
        await lane.browser("click", ".storage-failure button");
        await lane.until("!document.querySelector('.storage-failure')");
        expect(await lane.evaluate("(async () => (await import('/src/settings/preferences.ts')).appSettings().fontFamily)()")).toBe("Original font 雪");
        await lane.capture("U3787f", `head-${seed}-retained`);
      } finally { if (capture) await lane.browser("record", "stop"); }
    }
  } finally { await lane.close(); }
}, 180_000);
