import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";

// Capture-only policy observer: App tests in u3787a_undo prove the RPC contracts.
it.skipIf(!captureDir("U5127a") && !captureDir("U5127b"))("u5127a_u5127b_failed_refresh_and_recovery_rendered", { retry: 0, timeout: 120_000 }, async () => {
  const { openLane } = await import("./laneBrowser");
  const lane = await openLane(1512, "dark", "u5127");

  try {
    for (const id of ["U5127a", "U5127b"]) {
      const directory = captureDir(id);

      if (!directory) continue;
      mkdirSync(directory, { recursive: true });
      await lane.browser("record", "start", join(directory, "delete-refresh.webm"));

      try {
        await lane.browser("set", "media", "dark");
        await lane.seedTodos(Array.from({ length: 8 }, (_, index) => `${index} 長い é 🧭 日本語 ${"Review dependency ".repeat(10)}`), false); // taste-skill-ignore: Unicode worst-case fixture, not interface decoration.
        const [chosen, survivor] = await lane.order();
        await lane.capture(id, "before");
        await lane.browser("focus", `.shelf [data-todo="${chosen}"] .todo-row-button`);
        await lane.browser("press", "Enter");
        await lane.until("!!document.querySelector('.drawer .todo-detail-title')");
        await lane.evaluate(`(() => {
          const app = window.__fake.app;
          const list = app.handlers['todo.list'];
          window.__readAgain = () => { app.handlers['todo.list'] = list; };
          app.handlers['todo.list'] = () => { throw new Error('Todo list unavailable'); };
          return true;
        })()`);
        await lane.browser("click", '.drawer [aria-label="More actions"]');
        await lane.browser("wait", '[role="menu"][data-open]');
        await lane.browser("click", '[role="menuitem"][data-value="delete"]');
        await lane.until("!document.querySelector('.drawer[data-open=true]') && document.body.textContent.includes('Todo list unavailable')");
        expect(await lane.evaluate("window.__fake.app.calls.filter(call => call.method === 'todo.delete').map(call => call.params.ids)")).toEqual([[chosen]]);
        await lane.capture(id, "failed-read");
        await lane.evaluate("window.__readAgain(); true");

        if (id === "U5127a") {
          await lane.browser("focus", `.shelf [data-todo="${survivor}"] .todo-row-button`);
          await lane.browser("press", "Meta+z");
          await lane.until("window.__fake.app.calls.some(call => call.method === 'todo.restore') && !document.body.textContent.includes('Todo list unavailable')");
          await lane.capture(id, "undo");
        } else {
          await lane.evaluate(`window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'todo.deleted', data: { id: ${chosen} } }); true`);
          await lane.until(`!document.body.textContent.includes('Todo list unavailable') && !document.querySelector('.shelf [data-todo="${chosen}"]') && !!document.querySelector('.shelf [data-todo="${survivor}"]')`);
          await lane.capture(id, "recovered");
        }
      } finally { await lane.browser("record", "stop"); }
    }
  } finally { await lane.close(); }
});
