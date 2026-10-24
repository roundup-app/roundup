import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const capture = async (step: string) => {
  const dir = captureDir("P3557c");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`), null, 2));
};

it("p3557c_failure_lifetime_rail_renders_the_failure_before_and_after_clearing", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  await read(`(() => { window.__fake.app.handlers['rail.remove'] = () => { throw new Error('cannot remove'); }; return true; })()`);

  const remove = `(async () => {
    document.querySelector('.rail-row[data-id="backend"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 80 }));
    await window.__fake.app.pickMenu('Remove');
    await new Promise(done => setTimeout(done, 100));
    if (window.__question?.shown) window.__question.answer(true);
    return true;
  })()`;

  await read(remove);
  await wait(`document.body.textContent.includes('cannot remove')`);
  await capture("failed-remove");
  expect(await read<boolean>(`document.querySelector('[role=alert]').checkVisibility()`)).toBe(true);

  await read(`(() => { window.__fake.app.handlers['rail.remove'] = () => null; return true; })()`);

  await read(remove);
  await wait(`!document.body.textContent.includes('cannot remove')`);
  await capture("cleared-after-save");
}, 90_000);
