// U2749e commissions these hit-target assertions (#6340); they pin which element takes a press, not looks.
// oxlint-disable anti-slop/no-new-web-assertions
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { appServer, type AppServer } from "../testing/appServer";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

let server: AppServer;

beforeAll(async () => {
  if (!found) throw new Error("U2749e needs Chromium");
  server = await appServer();
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); await server?.close(); }, 60_000);

run("u2749e a tooltip takes no press", () => {
  it("u2749e_a_press_under_a_tooltip_reaches_the_control_beneath", async () => {
    await page.load(new URL("/src/ui/u2749e.html", server.resolvedUrls.local[0]!).href, 800, 400);
    const owner = await page.call<{ x: number; y: number }>(`() => { const b = document.getElementById("tip-owner").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }`);

    await page.hover(owner.x, owner.y);
    await page.until(`() => document.querySelector('[data-scope="tooltip"][data-part="content"]')`);

    // The press point is inside both the tooltip's box and the beneath button's box.
    const press = await page.call<{ x: number; y: number } | null>(`() => {
      const t = document.querySelector('[data-scope="tooltip"][data-part="content"]').getBoundingClientRect();
      const b = document.getElementById("beneath").getBoundingClientRect();
      const left = Math.max(t.left, b.left), right = Math.min(t.right, b.right), top = Math.max(t.top, b.top), bottom = Math.min(t.bottom, b.bottom);
      return left < right && top < bottom ? { x: (left + right) / 2, y: (top + bottom) / 2 } : null;
    }`);

    expect(press).not.toBeNull();
    const hit = await page.call<string>(`(x, y) => document.elementFromPoint(x, y)?.id ?? ""`, press!.x, press!.y);

    expect(hit).toBe("beneath");
    await page.click(press!.x, press!.y);
    expect(await page.call<string>(`() => document.getElementById("presses").textContent`)).toBe("1");
  }, 60_000);
});
