import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";
import { opened, openPad, source } from "./u5561a_support";

it.each(["pointer", "Return"].flatMap(input => [false, true].map(present => ({ input, present }))))("u5561b_block_menu_adds_agent_details $input $present", { retry: 0, timeout: 90_000 }, async ({ input, present }) => {
  await opened("/harness.html?seed=tree-40");
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  const initial = present ? source : "Ready to review.";
  await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: initial })})`);

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('.ProseMirror')");
  // U5631: the Pad-only action must survive a Todo → Pad return.
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  await browser("click", "#shelf-tab-todos");
  await wait("!!document.querySelector('[data-shelf-group=unassigned] .shelf-group-control')");

  if (await read("document.querySelector('.todos-tab [data-shelf-group=unassigned] .shelf-group-control').getAttribute('aria-expanded') === 'false'")) await browser("click", '.todos-tab [data-shelf-group=unassigned] .shelf-group-control');
  await wait("!!document.querySelector('.todo-row-button')");
  await browser("focus", ".todo-row-button");
  await browser("press", "Enter");
  await wait("!!document.querySelector('.todo-detail-title')");
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .todo-detail-title')");
  await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('.ProseMirror')");
  await browser("focus", ".ProseMirror");
  // Insert the menu command before the optional trailing section.
  await browser("press", "Control+Home");
  await browser("press", "End");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/For Agents");
  await wait("!!document.querySelector('.milkdown-slash-menu[data-show=true] li[data-index]')");

  const dir = captureDir("U5561b");

  if (dir) {
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, `block-menu-${input}-${present}.png`));
    await writeFile(join(dir, `block-menu-${input}-${present}.checks.json`), JSON.stringify(await read("window.__checks()")));
  }

  if (input === "pointer") await browser("click", ".milkdown-slash-menu[data-show=true] li[data-index]");
  else await browser("press", "Enter");
  await wait("document.activeElement?.matches('details[data-pad-agents] textarea')");
  expect(await read("document.querySelectorAll('details[data-pad-agents]').length")).toBe(1);

  if (present) expect(await read("document.querySelector('details[data-pad-agents] textarea').value")).toContain("raw evidence");
  await browser("fill", "details[data-pad-agents] textarea", " Agent evidence saved. ");

  if (dir) {
    await browser("screenshot", join(dir, `menu-${input}-${present}.png`));
    await writeFile(join(dir, `menu-${input}-${present}.checks.json`), JSON.stringify(await read("window.__checks()")));
  }

  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  const saved = await read<string>("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)");
  expect(saved).toBe("Ready to review.\n\n<details>\n<summary>For Agents</summary>\n\n Agent evidence saved. \n\n</details>");
  await openPad("!!document.querySelector('details[data-pad-agents]')");
  expect(await read("document.querySelector('details[data-pad-agents]').open")).toBe(false);
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
});
