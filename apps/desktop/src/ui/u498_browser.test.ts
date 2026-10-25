import { expect, it } from "vitest";
import { action, browser, click, load, read, selected, wait } from "./tabsBrowser";

it("u498_semantics_and_names", async () => {
  await load();
  await selected("Todos");
  expect(await read<unknown>(`[...document.querySelectorAll('[role=tab]')].map(tab => {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    return [tab.tabIndex, panel?.getAttribute('aria-labelledby') === tab.id, panel?.hidden];
  })`)).toEqual([[0, true, false], [-1, true, true]]);
  const { data: { snapshot } }: { data: { snapshot: string } } = JSON.parse(await browser("snapshot"));

  expect(snapshot).toContain('tablist "Shelf views"');
  expect(snapshot).toContain('tabpanel "Todos"');
  expect(snapshot).toContain('tab "Todos"');
  expect(snapshot).toContain('tab "Pads"');
  expect(snapshot).not.toContain('tabpanel "Pads"');
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
    expect(await read<boolean>(`document.activeElement.id === document.querySelector('[role=tab][aria-selected=true]').getAttribute('aria-controls')`)).toBe(true);
    await action("press", "Shift+Tab");
    await selected(name, true);
  }

  await click("tab", "Pads");
  await selected("Pads", true);
}, 60_000);
