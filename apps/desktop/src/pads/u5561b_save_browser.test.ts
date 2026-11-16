import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { captureSha, headingHitAreas, opened, openPad, source } from "./u5561aBrowser";

it("u5561b_failed_save_keeps_the_edited_agent_details", { retry: 0, timeout: 90_000 }, async () => {
  const failureSource = captureDir("U5704a")
    ? `# ${"A long wrapping heading with review evidence ".repeat(5)}\n\n## Second\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth\n\n${source}`
    : source;

  await opened("/harness.html?seed=tree-40");
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text: failureSource })})`);

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('details[data-pad-agents]')");
  await browser("click", "details[data-pad-agents] summary");
  await wait("document.querySelector('details[data-pad-agents]').open");
  await read("window.__fake.failNext(-32603, 'Pad not saved: restore write access, then Resume.', 'pad.write')");
  const draft = " Agent evidence after a failed save. ";
  await browser("fill", "details[data-pad-agents] textarea", draft);
  await wait("document.body.innerText.includes('restore write access')");
  expect(await read("document.querySelector('details[data-pad-agents] textarea').value")).toBe(draft);
  expect(await read("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)")).toBe(failureSource);
  const sizingDir = captureDir("U5704a");
  const dir = sizingDir ? join(sizingDir, process.env.ROUNDUP_CAPTURE_PHASE ?? "head") : captureDir("U5561b");

  if (sizingDir) {
    await browser("scroll", "up", "1000", "--selector", ".pad-editor");
    await wait("document.querySelector('.pad-editor').scrollTop === 0");
  }

  if (dir) {
    await mkdir(dir, { recursive: true });
    await browser("screenshot", join(dir, "save-failure.png"));
    await writeFile(join(dir, "save-failure.checks.json"), JSON.stringify({ ...await read<Checks>("window.__checks()"), observation: { sha: captureSha, seed: "tree-40", state: "save-failure", controls: await read(headingHitAreas), viewport: [1512, 950], scheme: "dark" } }));
  }

  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  await openPad("!!document.querySelector('details[data-pad-agents]')");
  expect(await read("document.querySelector('details[data-pad-agents] textarea').value")).toBe(draft);
});

it("u5561b_block_menu_inserts_two_labelled_toggles", { retry: 0, timeout: 120_000 }, async () => {
  await browser("eval", "localStorage.clear()");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait("!!window.__fake && !!document.querySelector('#shelf-tab-pads')");
  await read("window.__fake.app.rpc('pad.write', {name:'pad-3', text:'Between.'})");

  if (await read("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-pads");
  await wait("!!document.querySelector('.pad-name')");
  await openPad("!!document.querySelector('.ProseMirror')");

  for (const [label, body] of [["Before", "First evidence."], ["After", "Second evidence."]] as const) {
    await browser("click", ".ProseMirror > p:last-child");
    await browser("press", label === "Before" ? "Home" : "End");
    await browser("press", "Enter");

    if (label === "Before") await browser("press", "Control+Home");
    await browser("keyboard", "type", "/Toggle");
    await wait("!!document.querySelector('.milkdown-slash-menu[data-show=true] li[data-index]')");
    await browser("press", "Enter");
    await wait("document.activeElement?.matches('details[data-pad-agents] input')");
    const initialLabel = await read("document.activeElement.closest('details').querySelector('summary').textContent");
    await browser("press", "Control+a");
    await browser("keyboard", "type", label);
    expect(await read("document.activeElement.closest('details').querySelector('summary').textContent")).toBe(initialLabel);
    await browser("press", "Enter");
    const block = `details[data-pad-agents]:has(summary[aria-label="${label}"])`;
    await browser("fill", `${block} textarea`, body);
  }

  await browser("fill", 'details[data-pad-agents]:has(summary[aria-label="After"]) input', "");
  await browser("press", "Enter");
  await wait("!!document.querySelector('summary[aria-label=Toggle]')");
  await browser("click", ".drawer .close");
  await wait("!document.querySelector('.drawer .ProseMirror')");
  const saved = await read<string>("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(pad => pad.text)");
  expect(saved).toBe("<details>\n<summary>Before</summary>\n\nFirst evidence.\n\n</details>\n\nBetween.\n\n<details>\n<summary>Toggle</summary>\n\nSecond evidence.\n\n</details>");
  await openPad("document.querySelectorAll('details[data-pad-agents]').length === 2");
  expect(await read("[...document.querySelectorAll('details[data-pad-agents]')].every(d => !d.open)")).toBe(true);
});
