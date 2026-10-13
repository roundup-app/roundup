import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import type { Checks } from "./checks";
import { captureDir } from "./captures";

const found = chromePath();
const run = found || process.env["CI"] ? describe : describe.skip;
const art = captureDir("U464");
let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U464 needs a Chrome binary: set CHROME_PATH");
  page = await openPage(found);
}, 90_000);
afterAll(async () => { await page?.close(); });

const load = async (width = 1280) => {
  await page.load("/harness.html?seed=door-stopped", width, 800);
  await page.until(`() => Boolean(window.__fake && document.querySelector('[data-thread-input]'))`);
  await page.call(`() => document.fonts.ready`);
};
const fail = async (action: "start" | "send") => {
  await page.call(`(action) => {
    window.__fake.failNext(-32003, 'U464 call refused');
    if (action === 'start') [...document.querySelectorAll('button')].find(el => el.textContent.includes('Start Door')).click();
    else document.querySelector('.thread-send').click();
  }`, action);
  await page.until(`() => document.querySelector('p.ink[role=alert]')?.title === 'U464 call refused'`);
};
const draft = async (value: string) => {
  await page.call(`(value) => {
    const input = document.querySelector('[data-thread-input]');
    input.value = value;
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }`, value);
};
const checks = () => page.call<Checks>(`() => window.__checks()`);
const save = async (name: string) => {
  if (!art) return;
  mkdirSync(art, {recursive: true});
  writeFileSync(join(art, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(art, `${name}.checks.json`), JSON.stringify(await checks(), null, 2));
};

run("u464 failed calls on a stopped Door", () => {
  it("u464_a_failed_start_and_send_are_errors_for_d3", async () => {
    for (const width of [1280, 1440]) {
      for (const action of ["start", "send"] as const) {
        await load(width);
        const baseline = await checks();
        if (action === "send") await draft("keep this request on failure");
        await fail(action);
        const read = await checks();
        expect(read.D3.status).toBe("pass");
        expect(read.D10.status).toBe("pass");
        for (const id of Object.keys(baseline) as (keyof Checks)[]) {
          if (baseline[id].status === "pass") expect(read[id].status, id).toBe("pass");
        }
        expect(await page.call(`() => {
          const el = document.querySelector('p.ink[role=alert]');
          const style = getComputedStyle(el);
          return {kind: el.dataset.kind, title: el.title, text: el.textContent, colour: style.color};
        }`)).toEqual({kind: "error", title: "U464 call refused", text: "U464 call refused", colour: "rgb(196, 38, 46)"});
        await save(`${action}-${width}x800`);
      }
    }
  }, 90_000);
});
