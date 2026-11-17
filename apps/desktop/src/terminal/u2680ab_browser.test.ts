import { beforeAll, expect, it } from "vitest";
import { browser, read } from "../ui/tabsBrowser";
import { batch, drag, load, placement, point, setViewport } from "./u514Browser";

beforeAll(setViewport);

it.each([false, true])("u2680b_a_click_clears_browser_and_terminal_selections_stopped_%s", async (stopped) => {
  await load();
  await browser("eval", `(() => {
    const target = document.createElement('button');
    target.textContent = 'Outside terminal';
    target.id = 'outside';
    target.onpointerdown = event => { ${stopped ? 'event.preventDefault(); event.stopPropagation();' : ''} };
    document.body.append(target);
    window.__emu.selectTurn(0, false);
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection().addRange(range);
  })()`);
  expect(await read<string>("window.__emu.selection()")).not.toBe("");
  await browser("click", "#outside");
  expect(await read<{ terminal: string; browser: boolean }>("({ terminal: window.__emu.selection(), browser: getSelection().isCollapsed })")).toEqual({ terminal: "", browser: true });
}, 90_000);

it.each(["agent", "bubble"] as const)("u2680a_terminal_boundaries_never_create_browser_selection_%s", async (where) => {
  const selector = await placement(where);

  const points = await read<{ output: { x: number; y: number }; inset: { x: number; y: number }; strip: { x: number; y: number }; after: { x: number; y: number } }>(`(() => {
    const screen = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const host = document.querySelector(${JSON.stringify(selector)}).closest('.pane-screen, .bubble-body').getBoundingClientRect();
    return { output: { x: Math.round(screen.left + 20), y: Math.round(screen.top + 8) },
      inset: { x: Math.round(host.left + 1), y: Math.round(host.top + 12) },
      strip: { x: Math.round(screen.left + 20), y: Math.floor(host.bottom - 1) },
      after: { x: Math.floor(screen.right - 1), y: Math.round(screen.top + 8) } };
  })()`);

  const outside = await point(".rail");

  for (const area of [points.inset, points.strip, points.after, outside]) {
    await drag(points.output, area);
    expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);

    if (where === "bubble" && await read<boolean>("!document.querySelector('.bubble:not([hidden])')")) await browser("click", ".terminal-tab");
    await drag(area, points.output);
    expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);

    if (where === "bubble" && await read<boolean>("!document.querySelector('.bubble:not([hidden])')")) await browser("click", ".terminal-tab");
  }
}, 180_000);

// Remounting the App per target dominated this sweep; reseed selections on the same emulator instead.
it.each(["agent", "bubble"] as const)("u2680b_a_click_clears_browser_and_terminal_selections_%s", async where => {
  const selector = await placement(where);

  const targets = where === "agent" ? ["output", "inset", ".traffic-lights"]
    : ["output", ".bubble-header", '.bubble-zone[data-zone="se"]'];

  for (const target of targets) {
    await browser("dblclick", selector);
    expect(await read<string>("window.__emu.selection()"), target).not.toBe("");
    await browser("eval", "(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.project-tab .tab-name-button')); getSelection().removeAllRanges(); getSelection().addRange(range); })()");

    const at = target === "inset" ? await read<{ x: number; y: number }>(`(() => {
      const host = document.querySelector(${JSON.stringify(selector)}).closest('.pane-screen, .bubble-body').getBoundingClientRect();
      return { x: Math.round(host.left + 1), y: Math.round(host.top + 12) };
    })()`) : await point(target === "output" ? selector : target);

    await batch(
      ["mouse", "move", String(at.x), String(at.y)],
      ["mouse", "down"],
      ["mouse", "up"]
    );
    expect(await read<{ terminal: string; browser: boolean }>("({ terminal: window.__emu.selection(), browser: getSelection().isCollapsed })"), target).toEqual({ terminal: "", browser: true });
  }
}, 60_000);

it("u2680b_minimising_and_restoring_does_not_restore_selection", async () => {
  const selector = await placement("bubble");
  await browser("dblclick", selector);
  expect(await read<string>("window.__emu.selection()")).not.toBe("");
  await batch(
    ["click", ".traffic-lights"],
    ["wait", "--fn", "!document.querySelector('.bubble:not([hidden])')"]
  );
  expect(await read<string>("window.__emu.selection()")).toBe("");
  await batch(
    ["click", ".terminal-tab"],
    ["wait", "--fn", "!!document.querySelector('.bubble:not([hidden])')"]
  );
  expect(await read<string>("window.__emu.selection()")).toBe("");
}, 90_000);
