import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const capture = async (step: string) => {
  const dir = captureDir("U3770a") ?? captureDir("U3770b") ?? captureDir("U3770e") ?? captureDir("P3557c");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`), null, 2));
};

it("u3770e_the_drawer_renders_its_sections_with_a_failed_retry_visible", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  const dir = captureDir("P3557c");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    await browser("record", "start", join(dir, "failure-lifetime.webm"));
  }

  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  await read(`window.__fake.app.handlers['agent.resume'] = () => { throw new Error('cannot resume'); }`);
  await browser("press", "Meta+k");
  await browser("press", "i");
  await wait(`!!document.querySelector('[aria-label="Needs you"]')`);
  await capture("sections");

  const retry = await read<boolean>(`(() => {
    const row = [...document.querySelectorAll('.inbox-row')].find(each => each.closest('li')?.querySelector('[data-kind="error"], [aria-label="Error"]'));
    row?.click();
    return !!row;
  })()`);

  expect(retry).toBe(true);
  await wait(`[...document.querySelectorAll('button')].some(each => each.textContent === 'Retry' && each.checkVisibility())`);
  await read(`[...document.querySelectorAll('button')].find(each => each.textContent === 'Retry' && each.checkVisibility()).click()`);
  await wait(`!!document.querySelector('.inbox-body [role=alert]')`);
  await capture("failed-retry");
  expect(await read<boolean>(`document.querySelector('.inbox-body [role=alert]').checkVisibility()`)).toBe(true);
  await read(`[...document.querySelectorAll('.inbox-body button')].find(each => each.textContent === 'Dismiss').click()`);
  await wait(`!document.querySelector('.inbox-body [role=alert]')`);
  await capture("dismissed-retry");

  if (dir) await browser("record", "stop");
  expect(await read<boolean>(`!!document.querySelector('.inbox-body [role=alert]')`)).toBe(false);
}, 90_000);
