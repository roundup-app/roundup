import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const capture = async (id: string, step: string) => {
  const root = captureDir(id);

  if (!root) return;
  const dir = join(root, process.env.U5742_BASELINE ? "base" : "head");
  await mkdir(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
};

it.each(["agents-10", "tree-40"])("u5742a_rendered_rail_choices_and_controls_%s", async seed => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url(`/harness.html?seed=${seed}`, !!process.env.U5742_BASELINE));
  await wait("!!window.__fake && !!document.querySelector('.rail-row[data-id]')");
  await capture("U5742a", `${seed}-rest`);
  const target = await read<string>("document.querySelector('.rail-row[data-kind=\"needs-you\"]')?.dataset.id");
  await browser("click", `.rail-row[data-id="${target}"] .name`);
  await wait("!!document.querySelector('.pane-screen .xterm-helper-textarea')");

  if (!process.env.U5742_BASELINE) {
    await wait("!!document.activeElement?.closest('.pane-screen')");
    expect(await read("!!document.activeElement?.closest('.pane-screen')")).toBe(true);
  }

  await capture("U5742a", `${seed}-chosen`);
  await read(`(() => { const rows = [...document.querySelectorAll('.rail-row[data-id]')]; rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); rows.at(-1).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); })()`);
  expect(await read("!!document.activeElement?.closest('.rail')")).toBe(true);
  await capture("U5742b", `${seed}-multiple`);
  await read(`(() => { const row = document.querySelector('.rail-row[data-id="${target}"]'); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true, cancelable:true})); })()`);
  await wait("!!document.activeElement?.closest('.pane-screen')");
  await capture("U5742c", `${seed}-enter`);
  await capture("U5742d", `${seed}-ready`);
});
