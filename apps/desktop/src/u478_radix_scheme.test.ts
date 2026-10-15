import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "./testing/chromePage";
import type { ChromePage } from "./testing/chromePage";

// Radix Colors' gray 1 in the sRGB and Display P3 spellings the package declares.
const GRAY_1 = { light: /^(#fcfcfc|color\(display-p3 0\.988 0\.988 0\.988\))$/, dark: /^(#111111|color\(display-p3 0\.067 0\.067 0\.067\))$/ } as const;

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U478 requires headless Chromium");
  page = await openPage(chrome);
}, 60_000);

afterAll(async () => {
  await page?.close();
});

// The probe is a real App muted-text element: styles.css owns `.light:not(button)`, which must keep its colour in both schemes.
const PROBE = `() => {
  const probe = document.createElement('span');
  probe.className = 'light';
  document.body.append(probe);
  const read = element => getComputedStyle(element).getPropertyValue('--gray-1').trim();
  const result = { root: read(document.documentElement), probe: read(probe), colour: getComputedStyle(probe).color, grey: getComputedStyle(document.documentElement).getPropertyValue('--grey').trim() };
  probe.remove();
  return result;
}`;

type Probe = { root: string; probe: string; colour: string; grey: string };

it("u478_radix_grays_follow_prefers_color_scheme", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    const { root, probe, colour, grey } = await page.call<Probe>(PROBE);

    // Clause 1: light and dark values from the package, switched by the scheme the App's Tokens already follow.
    expect(root, `${scheme} :root --gray-1`).toMatch(GRAY_1[scheme]);
    // Radix's `.light` rule must not re-declare Tokens on the App's `.light` muted-text class.
    expect(probe, `${scheme} .light --gray-1`).toMatch(GRAY_1[scheme]);

    const swatch = await page.call<string>(`token => { const el = document.createElement('i'); el.style.color = token; document.body.append(el); const out = getComputedStyle(el).color; el.remove(); return out; }`, grey);

    expect(colour, `${scheme} .light colour`).toBe(swatch);
  }
}, 60_000);
