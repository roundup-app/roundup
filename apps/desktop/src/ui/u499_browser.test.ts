import { expect, it } from "vitest";
import { action, click, load, read, selected, wait } from "./tabsBrowser";

it("u499_controlled_selection", async () => {
  await load("?controlled");
  await click("tab", "Pads");
  await wait(`document.querySelector('[aria-label=Requests]').textContent === '1:pads'`);
  await selected("Todos");
  await click("button", "Accept");
  await selected("Pads");
  await click("button", "External Todos");
  await selected("Todos");
  expect(await read<string>(`document.querySelector('[aria-label=Requests]').textContent`)).toBe("1:pads");
}, 60_000);

it("u499_content_retention", async () => {
  await load("?content");
  // Save DOM identity before either panel is visited: retention includes the initially inactive panel.
  await read(`window.__panelNodes = [...document.querySelectorAll('[data-draft]')]`);

  for (const [name, draft] of [["Todos", "Keep this todo"], ["Pads", "Keep this pad"]] as const) {
    await click("tab", name);
    await selected(name);
    await action("find", "label", `${name} draft`, "fill", draft, "--exact");
    await wait(`document.querySelector('[aria-label="${name} draft"]').value === '${draft}'`);
    await click("button", `Increment ${name}`);
    await wait(`document.querySelector('[aria-label="${name} count"]').textContent === '1'`);
  }

  for (const [name, draft] of [["Todos", "Keep this todo"], ["Pads", "Keep this pad"]] as const) {
    await click("tab", name);
    await selected(name);
    expect(await read<unknown>(`(() => {
      const panel = document.querySelector('[data-draft=${name}]');
      return { draft: panel.querySelector('input').value, count: panel.querySelector('output').textContent, mount: panel.dataset.mount, same: window.__panelNodes.includes(panel) };
    })()`)).toEqual({ draft, count: "1", mount: "1", same: true });
  }

}, 60_000);
