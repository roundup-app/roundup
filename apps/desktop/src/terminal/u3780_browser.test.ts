import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { chromePath, FULLSCREEN, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U3780 needs isolated headless Chromium: set CHROME_PATH");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

it("u3780_rendered_checks", async () => {
  for (const [scheme, contrast] of [["light", undefined], ["dark", undefined], ["dark", "more"]] as const) {
    await page.scheme(scheme, contrast);
    await page.load("/harness.html?seed=note-queue", FULLSCREEN.width, FULLSCREEN.height);
    await page.until(`() => Boolean(window.__fake && document.querySelector('.rail-row'))`);
    await page.call(`() => document.querySelector('.rail-row[data-id="agent-4"]').click()`);
    await page.until(`() => Boolean(document.querySelector('.pane'))`);
    await page.until(`() => document.querySelectorAll('.note-queue-row').length === 4`);

    const checks = await page.call<Checks>(`() => window.__checks()`);
    const dir = captureDir("U3780");
    const step = `queue-${scheme}${contrast ? "-contrast" : ""}`;

    if (dir && scheme === "dark") {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${step}.png`), Buffer.from(await page.shot(), "base64"));
      writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(checks, null, 2));
    }

    expect(CHECK_IDS.filter((id) => checks[id].status === "fail"), step).toEqual([]);
  }
}, 240_000);
