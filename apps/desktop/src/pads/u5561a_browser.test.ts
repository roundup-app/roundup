import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

const source = "Ready to review.\n\n<details>\n<summary>For Agents</summary>\n\nPath: `日本語/café`\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n\n~~~text\nraw evidence\n~~~\n\n</details>";

it("u5561a_pad_disclosure_toggles_without_writing", { retry: 0, timeout: 90_000 }, async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: source })})`);

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await read(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'pad-3').focus(); return true; })()`);
  await browser("press", "Enter");
  await wait("!!document.querySelector('details[data-pad-agents] summary')");
  const count = await read<number>("window.__fake.app.calls.filter(call => call.method === 'pad.write').length");
  const section = "details[data-pad-agents]";

  const capture = async (name: string) => {
    const dir = captureDir("U5561a");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, `${name}.png`));
    await writeFile(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()")));
  };

  expect(await read(`document.querySelector('${section}').open`)).toBe(false);
  expect(await read(`document.querySelector('${section} textarea').checkVisibility({contentVisibilityAuto:true})`)).toBe(false);
  await capture("folded");

  for (const input of ["pointer", "Return"]) {
    if (input === "Return") await browser("focus", `${section} summary`);

    for (const open of [true, false]) {
      if (input === "pointer") await browser("click", `${section} summary`);
      else await browser("press", "Enter");
      await wait(`document.querySelector('${section}').open === ${open}`);
      expect(await read(`document.querySelector('${section} textarea').checkVisibility({contentVisibilityAuto:true})`)).toBe(open);

      if (input === "Return") expect(await read(`document.activeElement.matches('${section} summary')`)).toBe(true);
      await capture(`${input}-${open}`);
    }
  }

  expect(await read(`document.querySelectorAll('${section} img, ${section} script, ${section} a').length`)).toBe(0);
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'pad.write').length")).toBe(count);
  expect(await read("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)")).toBe(source);
});

it.each(["pointer", "Return"].flatMap(input => [false, true].map(present => ({ input, present }))))("u5561b_block_menu_adds_agent_details $input $present", { retry: 0, timeout: 90_000 }, async ({ input, present }) => {
  await browser("set", "media", "dark");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  const initial = present ? source : "Ready to review.";
  await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: initial })})`);

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await read(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'pad-3').focus(); return true; })()`);
  await browser("press", "Enter");
  await wait("!!document.querySelector('.ProseMirror')");
  await browser("focus", ".ProseMirror");
  // Insert the menu command before the optional trailing section.
  await browser("press", "Control+Home");
  await browser("press", "End");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/For Agents");
  await wait("!!document.querySelector('.milkdown-slash-menu[data-show=true] li[data-index]')");

  if (input === "pointer") await browser("click", ".milkdown-slash-menu[data-show=true] li[data-index]");
  else await browser("press", "Enter");
  await wait("document.activeElement?.matches('details[data-pad-agents] textarea')");
  expect(await read("document.querySelectorAll('details[data-pad-agents]').length")).toBe(1);

  if (present) expect(await read("document.querySelector('details[data-pad-agents] textarea').value")).toContain("raw evidence");
  await browser("fill", "details[data-pad-agents] textarea", "Agent evidence saved.");
  const dir = captureDir("U5561b");

  if (dir) {
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, `menu-${input}-${present}.png`));
    await writeFile(join(dir, `menu-${input}-${present}.checks.json`), JSON.stringify(await read("window.__checks()")));
  }

  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  const saved = await read<string>("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)");
  expect(saved).toContain("<details>\n<summary>For Agents</summary>\n\nAgent evidence saved.\n\n</details>");
  expect(saved.match(/<details>/g)).toHaveLength(1);
  await read(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'pad-3').focus(); return true; })()`);
  await browser("press", "Enter");
  await wait("!!document.querySelector('details[data-pad-agents]')");
  expect(await read("document.querySelector('details[data-pad-agents]').open")).toBe(false);
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
});
