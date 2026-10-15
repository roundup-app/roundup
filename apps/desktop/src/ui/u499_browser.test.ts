import { expect, it } from "vitest";
import { action, click, load, read, selected, snapshot } from "./tabsBrowser";

it("u499_controlled_selection", async () => {
  await load("?controlled");
  await click("tab", "Pads");
  expect(await read(`document.querySelector('[aria-label=Requests]').textContent`)).toBe("1:pads");
  await selected("Todos");
  await click("button", "Accept");
  await selected("Pads");
  await click("button", "External Todos");
  await selected("Todos");
  expect(await read(`document.querySelector('[aria-label=Requests]').textContent`)).toBe("1:pads");
}, 60_000);

it("u499_content_retention", async () => {
  await load("?content");

  for (const name of ["Todos", "Pads"] as const) {
    await click("tab", name);
    await selected(name);
    await action("fill", `[aria-label="${name} draft"]`, `${name} draft text`);
    await click("button", `Increment ${name}`);
  }

  await click("tab", "Todos");
  await selected("Todos");
  expect(await read(`[...document.querySelectorAll('[data-draft]')].map(panel => [panel.dataset.mount, panel.querySelector('input').value, panel.querySelector('output').textContent])`)).toEqual([
    ["1", "Todos draft text", "1"], ["1", "Pads draft text", "1"],
  ]);
  expect(await read(`document.querySelector('[data-caller=trigger]').dataset.ref`)).toBe("connected");
  expect(await snapshot()).toContain('tab "Todos"');
}, 60_000);
