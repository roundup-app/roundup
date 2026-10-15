import { expect, it } from "vitest";
import { action, browser, click, load, read, selected, snapshot, wait } from "./tabsBrowser";

it("u498_semantics_and_names", async () => {
  await load();
  await browser("find", "role", "tablist", "text", "--name", "Shelf views", "--exact");
  await browser("find", "role", "tab", "text", "--name", "Todos");
  await browser("find", "role", "tab", "text", "--name", "Pads");
  await selected("Todos");
  expect(await read<unknown>(`[...document.querySelectorAll('[role=tab]')].map(tab => {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    return [tab.tabIndex, panel?.getAttribute('aria-labelledby') === tab.id, panel?.hidden];
  })`)).toEqual([[0, true, false], [-1, true, true]]);
  const tree = await snapshot();

  expect(tree).toContain('tab "Todos"');
  expect(tree).toContain('tab "Pads"');
  expect(tree).toContain('tabpanel "Todos"');
  expect(tree).not.toContain('tabpanel "Pads"');
}, 60_000);

it("u498_pointer_switching", async () => {
  await load();

  for (const name of ["Pads", "Todos", "Todos"] as const) {
    await click("tab", name);
    await selected(name);
  }
}, 60_000);

it("u498_keyboard_switching", async () => {
  await load();
  await click("button", "Before");
  await action("press", "Tab");
  await selected("Todos", true);

  for (const [key, name] of [["ArrowRight", "Pads"], ["ArrowLeft", "Todos"], ["End", "Pads"], ["Home", "Todos"]] as const) {
    await action("press", key);
    await selected(name, true);
  }
}, 60_000);

it("u498_selected_panel_focus", async () => {
  await load();

  for (const name of ["Todos", "Pads"] as const) {
    await click("tab", name);
    await selected(name, true);
    await action("press", "Tab");
    await wait(`document.activeElement?.getAttribute('role') === 'tabpanel'`);
    expect(await read(`document.activeElement.id === document.querySelector('[role=tab][aria-selected=true]').getAttribute('aria-controls')`)).toBe(true);
    await action("press", "Shift+Tab");
    await selected(name, true);
  }
}, 60_000);
