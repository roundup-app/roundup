import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3787c"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

it.each(["tree-40", "tabs-8", "conflict"])("u3787c_shelf_selection_is_instant_on_dense_seeds %s", async seed => {
    const dir = captureDir("U3787c");

    if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, `${seed}.webm`)); }

    try {
      await lane.seedTodos(["same", "same", "長い名前 é 🧭 ".repeat(12), "dependent", "fifth", "sixth"], true, seed);
      await lane.browser("set", "media", "dark");

      for (const kind of ["todos", "pads"]) {
        if (kind === "pads") {
          await lane.evaluate(`(async () => {
            const rpc = window.__fake.app.rpc;
            for (const pad of await rpc('pad.list', null)) await rpc('pad.delete', { name: pad.name });
            window.__fake.actAs({ kind: 'agent', id: 'tokens', parent: null });
            for (const name of ['first', 'second', '長い名前 é 🧭 '.repeat(10), 'fourth', 'fifth', 'sixth']) await rpc('pad.create', { name, text: 'original content' });
            window.__fake.actAs({ kind: 'user', id: 'you', parent: null });
            document.querySelector('#shelf-tab-pads').click();
            return true;
          })()`);
        }

        const selector = `.shelf ${kind === "todos" ? ".todo-row-button" : ".pad-name"}`;
        await lane.until(`document.querySelectorAll('${selector}').length === 6`);
        await lane.resetCalls();
        await lane.browser("focus", selector);
        await lane.capture("U3787c", `${seed}-${kind}-before`);
        await lane.browser("press", "End");
        await lane.until(`document.activeElement === [...document.querySelectorAll('${selector}')].at(-1)`);
        expect(await lane.evaluate<boolean>(`document.activeElement === [...document.querySelectorAll('${selector}')].at(-1)`)).toBe(true);
        await lane.browser("press", "Meta+a");
        await lane.until(`document.querySelectorAll('${selector}[aria-pressed=true]').length === 6`);
        expect(await lane.calls()).toEqual([]);
        await lane.capture("U3787c", `${seed}-${kind}-selected`);
      }

      await lane.evaluate("(() => { window.__fake.failNext(-32003, 'Denied. Retry.'); [...document.querySelectorAll('.shelf button')].find(b => b.textContent === 'Delete 6').click(); return true; })()");
      await lane.until("document.body.textContent.includes('Could not delete')");
      await lane.capture("U3787c", `${seed}-partial-failure`);
    } finally { if (dir) await lane.browser("record", "stop"); }
}, 180_000);
