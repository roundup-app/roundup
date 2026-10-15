import { expect, it } from "vitest";
import { action, browser, click, load, read, selected, wait } from "./tabsBrowser";

it("u498_semantics_and_names", async () => {
  await load();
  await browser("find", "role", "tablist", "get", "text", "--name", "Shelf views", "--exact");
  await browser("find", "role", "tab", "get", "text", "--name", "Todos", "--exact");
  await browser("find", "role", "tab", "get", "text", "--name", "Pads", "--exact");
  await selected("Todos");
  expect(await read<unknown>(`[...document.querySelectorAll('[role=tab]')].map(tab => {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    return [tab.tabIndex, panel?.getAttribute('aria-labelledby') === tab.id, panel?.hidden];
  })`)).toEqual([[0, true, false], [-1, true, true]]);
  const snapshot = await browser("snapshot");

  expect(snapshot).toContain('tabpanel "Todos"');
  expect(snapshot).not.toContain('tabpanel "Pads"');
}, 60_000);
