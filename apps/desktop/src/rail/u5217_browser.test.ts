import { beforeAll, afterAll, it, expect } from "vitest";
import { lane, fresh, run, quote, wait, cases, openCreateLane, closeCreateLane } from "./u5555_support";

beforeAll(() => openCreateLane(), 60_000);

afterAll(() => closeCreateLane(), 60_000);

it.each(cases)("u5217_rendered_menu_matches_chord $seed $kind", async ({ seed, kind, chord }) => {
  const outcomes = [];
  const settled = kind === "mode" ? "!!document.querySelector('[role=dialog]')" : "window.__fake.app.calls.some(call => ['agent.spawn','rail.createWorkstream'].includes(call.method))";

  for (const menu of [false, true]) {
    await fresh(seed);

    if (menu) {
      await run(`click ${quote('[aria-label="Create"]')}`, wait("!!document.querySelector('[role=menu]')"));
      expect(await lane.evaluate("[...document.querySelectorAll('[role=menuitem]')].map(item => [item.getAttribute('data-value'), item.getAttribute('aria-keyshortcuts'), item.querySelector('kbd').textContent])")).toEqual([
        ["agent", "Meta+N", "⌘N"], ["workstream", "Alt+Meta+N", "⌥⌘N"], ["mode", "Shift+Meta+M", "⇧⌘M"],
      ]);
      expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);

      if (kind === "agent") await lane.capture("U5217", `${seed}-menu`);
      await run(`click ${quote(`[role=menuitem][data-value=${kind}]`)}`, wait(settled), wait("!document.querySelector('[role=menu]')"));
    } else await run(`press ${chord}`, wait(settled), wait("!document.querySelector('[role=menu]')"));
    outcomes.push(await lane.evaluate("({ calls: window.__fake.app.calls.filter(call => ['agent.spawn','rail.createWorkstream'].includes(call.method)).map(call => ({method:call.method,params:call.params})), selection: document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id'), dialog: !!document.querySelector('[role=dialog]'), focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.getAttribute('data-id') })"));
  }

  expect(outcomes[1]).toEqual(outcomes[0]);
}, 60_000);
