import { beforeAll, expect, it } from "vitest";
import { browser, read } from "../ui/tabsBrowser";
import { placement, reportingSelection, rightAt, setViewport } from "./u514Browser";

beforeAll(setViewport);

it.each(["agent", "user", "bubble"] as const)("u5549a_option_drag_selects_without_mouse_bytes_%s", async where => {
  const selector = await placement(where, true, "");

  for (const mode of [1000, 1002]) {
    await reportingSelection(where, mode, undefined, selector);

    const [modifiers, selection, browserCollapsed, input, calls] = await read<unknown[]>(`[
      window.__mouseModifiers,
      window.__emu.selection(),
      getSelection().isCollapsed,
      window.__input,
      window.__fake.app.calls.slice(window.__calls).filter(c => c.method === 'terminal.write')
    ]`);

    expect(modifiers).toEqual([[true, false]]);
    expect(selection).toBe("café alpha bravo charlie\n日本語 delta");
    expect(browserCollapsed).toBe(true);
    expect(input).toEqual([]);
    expect(calls).toEqual([]);
  }
}, 120_000);

it.each(["agent", "user", "bubble"] as const)("u5549b_reporting_selection_keeps_readonly_menu_%s", async where => {
  const selector = await placement(where, true, "");

  for (const mode of [1000, 1002]) {
    const { from, cells } = await reportingSelection(where, mode, undefined, selector);
    const selected = await read<string>("window.__emu.selection()");
    expect(selected).toBe("café alpha bravo charlie\n日本語 delta");
    await browser("eval", `(() => {
      window.__calls = window.__fake.app.calls.length;
      window.__clipboard = window.__fake.app.clipboardWrites.length;
      window.__input = [];
      window.__controls = [...document.querySelectorAll('[role=menu], [role=dialog], .app-popover')];
      document.addEventListener('mousedown', () => { queueMicrotask(() => { window.__pressSelection = window.__emu.selection(); }); }, { once: true, capture: true });
      document.elementFromPoint(${from.x}, ${from.y}).closest('.xterm').addEventListener('contextmenu', () => { window.__contextSelection = { terminal: window.__emu.selection(), browser: getSelection().toString() }; }, { once: true, capture: true });
    })()`);
    await rightAt({ x: Math.round(from.x + cells.width * 7), y: from.y });

    const [context, pressSelection, contextSelection, selectionBeforeRelease, selection, input, calls, clipboardWrites, controls] = await read<unknown[]>(`[
      window.__context,
      window.__pressSelection,
      window.__contextSelection,
      window.__selectionBeforeRelease,
      ({ terminal: window.__emu.selection(), browser: getSelection().toString() }),
      window.__input,
      window.__fake.app.calls.slice(window.__calls).filter(c => ['terminal.write', 'message.send', 'agent.spawn', 'terminal.open'].includes(c.method)),
      window.__fake.app.clipboardWrites.length - window.__clipboard,
      [...document.querySelectorAll('[role=menu], [role=dialog], .app-popover')].filter(node => !window.__controls.includes(node)).length
    ]`);

    expect(context).toEqual({ editable: false, cancelled: false, selected });
    expect(pressSelection).toBe(selected);
    expect(contextSelection).toEqual({ terminal: selected, browser: selected });
    expect(selectionBeforeRelease).toBe(selected);
    expect(selection).toEqual({ terminal: selected, browser: selected });
    expect(input).toEqual([]);
    expect(calls).toEqual([]);
    expect(clipboardWrites).toBe(0);
    expect(controls).toBe(0);
  }
}, 120_000);
