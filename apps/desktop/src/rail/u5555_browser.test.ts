import { beforeAll, afterAll, it, expect } from "vitest";
import { captureDir } from "../testing/captures";
import { lane, fresh, run, quote, wait, menuClosed, menuFocused, cases, openCreateLane, closeCreateLane } from "./u5555_support";

const recording = captureDir("U5555");

beforeAll(() => openCreateLane(recording), 60_000);

afterAll(() => closeCreateLane(recording), 60_000);

it.each(cases)("u5555_rendered_keyboard_chooses $seed $kind", async ({ seed, kind, index }) => {
  await fresh(seed);
  const highlighted = (value: string) => wait(`document.querySelector('[role=menuitem][data-highlighted]')?.getAttribute('data-value') === '${value}'`);

  await run(`focus ${quote('[aria-label="Create"]')}`, "press Shift+Tab", "press Tab");
  expect(await lane.focused()).toBe("Create");
  await run(`press ${index % 2 ? "Space" : "Enter"}`, wait(menuFocused), "press Home", highlighted("agent"), "press ArrowDown", highlighted("workstream"), "press ArrowUp", highlighted("agent"));
  await lane.browser("press", "Escape");
  await lane.until(menuClosed);
  expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);
  await lane.capture("U4313b", `${seed}-rest`);
  await run("press Space", wait(menuFocused), "press Home", ...Array.from({ length: index }, () => "press ArrowDown"), highlighted(kind), "press Enter", wait(kind === "mode" ? "!!document.querySelector('[role=dialog]')" : "window.__fake.app.calls.some(call => ['agent.spawn','rail.createWorkstream'].includes(call.method))"));
  expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toHaveLength(kind === "mode" ? 0 : 1);
}, 60_000);
