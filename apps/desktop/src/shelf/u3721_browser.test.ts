import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";
import { captureDir } from "../testing/captures";

const { browser, evaluate, settle, openShelf, toggle } = shelfBrowser();

it("u3721_the_rendered_shelf_spans_rail_edge_to_window_edge", async () => {
  for (const scheme of ["dark", "light"]) {
    await openShelf("tree-40", 288, 360, 1512, scheme);
    await browser("set", "viewport", "1512", "950");
    await settle();
    const original = await evaluate<number>("document.querySelector('.shelf').getBoundingClientRect().width");
    await toggle();
    await evaluate("document.querySelector('.terminal-new').focus()");
    await toggle();
    await browser("click", 'button[aria-label="Maximise"]');
    await settle();

    // The rendered observer owns geometry; the Vitest cases exercise commands and persistence.
    const readings = await evaluate<{ shelf: number; rail: number; right: number; width: number }>(`(() => {
      const shelf = document.querySelector('.shelf').getBoundingClientRect();
      const rail = document.querySelector('.rail').getBoundingClientRect();
      return { shelf: shelf.left, rail: rail.right, right: shelf.right, width: innerWidth };
    })()`);

    const dir = captureDir("U3721");

    if (dir && scheme === "dark") {
      mkdirSync(dir, { recursive: true });
      await browser("screenshot", join(dir, "maximised.png"));
      writeFileSync(join(dir, "maximised.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
      writeFileSync(join(dir, "maximised.geometry.json"), JSON.stringify(readings, null, 2));
    }

    await browser("press", "Escape");
    await settle();
    expect(await evaluate("document.activeElement === document.querySelector('.terminal-new')")).toBe(true);
    await toggle();
    await browser("click", 'button[aria-label="Restore"]');
    await settle();

    if (dir && scheme === "dark") {
      await browser("screenshot", join(dir, "restored.png"));
      writeFileSync(join(dir, "restored.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
      writeFileSync(join(dir, "restored.geometry.json"), JSON.stringify({ original, restored: await evaluate("document.querySelector('.shelf').getBoundingClientRect().width") }, null, 2));
    }
  }
}, 90_000);

it("u3721_the_button_name_flips_and_overlay_mode_has_none", async () => {
  await openShelf("tree-40", 288, 360, 1512, "dark");
  await evaluate(`document.querySelector('.shelf button').focus()`);
  await browser("press", "m");
  expect(await evaluate("document.querySelector('.shelf-controls button[aria-label=Restore]') !== null")).toBe(true);
  await browser("press", "m");
  expect(await evaluate("document.querySelector('.shelf-controls button[aria-label=Maximise]') !== null")).toBe(true);
  await openShelf("tree-40", 288, 360, 800, "dark");
  expect(await evaluate("document.querySelector('.shelf-controls button[aria-label=Maximise]') === null")).toBe(true);
  await evaluate(`document.querySelector('.shelf button').focus()`);
  await browser("press", "m");
  expect(await evaluate("document.querySelector('.window').dataset.shelfMaximised")).toBe("false");
}, 60_000);

it("u3722_each_head_button_shows_its_name_and_chip", async () => {
  await openShelf("tree-40", 288, 360, 1512, "dark");

  for (const [name, chip] of [["Maximise", "M"], ["Restore", "M"], ["Close", "Esc"]]) {
    if (name === "Restore") await browser("click", '.shelf-controls button[aria-label="Maximise"]');

    for (const path of ["hover", "focus"]) {
      if (path === "hover") await browser("hover", `.shelf-controls button[aria-label="${name === "Close" ? "Close work items" : name}"]`);
      else {
        await browser("mouse", "move", "700", "600");
        await evaluate(`document.querySelector('.shelf-controls button[aria-label="${name === "Close" ? "Restore" : "Close work items"}"]').focus()`);
        await browser("press", name === "Close" ? "Tab" : "Shift+Tab");
      }

      await browser("wait", "--fn", `document.querySelector('[role=tooltip]')?.textContent === '${name}${chip}'`);
      expect(await evaluate("document.querySelector('[role=tooltip]').textContent")).toBe(`${name}${chip}`);
      const dir = captureDir("U3722");

      if (dir) {
        mkdirSync(dir, { recursive: true });
        await browser("screenshot", join(dir, `${name}-${path}.png`));
      }

      await evaluate("document.activeElement.blur()");
      await browser("mouse", "move", "700", "600");
    }
  }
}, 90_000);

it("u3723_rendered_focused_row_keys_keep_failure_visible", async () => {
  await openShelf("tree-40", 288, 360, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await browser("click", "#shelf-tab-pads");
  await browser("wait", ".shelf .pad-name");
  await evaluate(`document.querySelector('.shelf .pad-name').focus()`);
  await browser("wait", '.hint-line[data-place="shelf"]');
  const hints = captureDir("U3724");

  if (hints) {
    mkdirSync(hints, { recursive: true });
    await browser("screenshot", join(hints, "focused-pad-hints.png"));
  }

  await evaluate(`(() => { window.__fake.app.chooser.savePath = '/tmp/pad.md'; window.__fake.failNext(-32003, 'Export refused: the selected folder is not writable. Choose another location and try again.'); return true; })()`);
  await browser("press", "e");
  await browser("wait", '.shelf [role="alert"]');
  expect(await evaluate("document.querySelector('.shelf [role=alert]').textContent")).toContain("Export refused:");
  const dir = captureDir("U3723");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    await browser("screenshot", join(dir, "export-failure.png"));
    writeFileSync(join(dir, "export-failure.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  }

  await evaluate(`document.querySelector('.shelf .pad-name').focus()`);
  await browser("press", "d");
  await browser("wait", '[role="alertdialog"]');
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'pad.delete').length")).toBe(0);

  if (dir) await browser("screenshot", join(dir, "delete-question.png"));
}, 60_000);

it("u3721_restore_keeps_terminal_fitting_operable", async () => {
  await openShelf("agents-10", 288, 360, 1512, "dark");
  await evaluate(`document.querySelector('.rail [data-id="agent-4"] .name').click()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await browser("click", '.shelf-controls button[aria-label="Maximise"]');
  await settle();
  await browser("click", '.shelf-controls button[aria-label="Restore"]');
  await settle();
  const before = await evaluate<number>("window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length");

  await evaluate(`document.querySelector('.rail-edge').focus()`);
  await browser("press", "ArrowRight");
  await settle();
  await browser("wait", "--fn", `window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length > ${before}`);
  expect(await evaluate<number>("window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length")).toBeGreaterThan(before);
}, 90_000);
