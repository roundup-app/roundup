import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U386 in a real Chromium: jsdom does not match `:active`, so the computed values are read with the pointer down on the `backend` row's `collapse` chevron and on its body. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U386");

beforeAll(async () => {
  if (!found) throw new Error("U386 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Reading = { row: string; button: string };

/** Page-side: the `backend` row and its chevron's centre, the row's body point, and the `--pressed` and `--hover` tokens resolved to colours. */
const FIND = `() => {
  const row = [...document.querySelectorAll(".rail-row")].find((own) => own.textContent.includes("backend") && own.querySelector('[aria-label="collapse"]'));
  const box = row.getBoundingClientRect();
  const chevron = row.querySelector('[aria-label="collapse"]').getBoundingClientRect();
  const probe = document.createElement("i");
  const token = (name) => { probe.style.backgroundColor = "var(" + name + ")"; document.body.appendChild(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; };
  return { chevron: [chevron.left + chevron.width / 2, chevron.top + chevron.height / 2], body: [box.right - 6, box.top + box.height / 2], pressed: token("--pressed"), hover: token("--hover") };
}`;

const READ = `() => {
  const row = [...document.querySelectorAll(".rail-row")].find((own) => own.textContent.includes("backend") && own.querySelector('[aria-label="collapse"]'));
  return { row: getComputedStyle(row).backgroundColor, button: getComputedStyle(row.querySelector('[aria-label="collapse"]')).backgroundColor };
}`;

run("u386 in a real Chromium", () => {
  it.each(["light", "dark"] as const)("u386_a_press_shows_on_the_chevron_only_%s", async (scheme) => {
    await page.scheme(scheme);
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    await page.until(`() => [...document.querySelectorAll(".rail-row")].some((own) => own.textContent.includes("backend") && own.querySelector('[aria-label="collapse"]'))`, 20_000);

    const at = await page.call<{ chevron: [number, number]; body: [number, number]; pressed: string; hover: string }>(FIND);

    await page.hover(1200, 780);

    const rest = await page.call<Reading>(READ);

    await page.hover(...at.chevron);

    const hovered = await page.call<Reading>(READ);

    await page.down(...at.chevron);

    const onChevron = await page.call<Reading>(READ);

    await page.release(...at.chevron);
    await page.hover(...at.body);
    await page.down(...at.body);

    const onBody = await page.call<Reading>(READ);

    await page.release(...at.body);

    mkdirSync(ART, { recursive: true });
    writeFileSync(resolve(ART, `readings-${scheme}.json`), `${JSON.stringify({ viewport: "1280x800", seed: "tree-40", scheme, tokens: { pressed: at.pressed, hover: at.hover }, rest, hovered, onChevron, onBody }, null, 2)}\n`);

    // The row shows no --pressed while its chevron is down; the chevron's pressed value is its own.
    expect(onChevron.row).toBe(hovered.row);
    expect(onChevron.row).not.toBe(at.pressed);
    expect(onChevron.button).not.toBe(hovered.button);
    expect(onBody.row).toBe(at.pressed);
  }, 60_000);
});
