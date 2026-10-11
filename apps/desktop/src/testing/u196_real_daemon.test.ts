import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** U196's observer: the real `rupd` and a real Chromium; the user's 400-character Message clamps at two lines, opens whole and stays within 80ch. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U196");

beforeAll(async () => {
  if (!found) throw new Error("U196 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({}, true);
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

const BODY = "A long note from the user that goes on and on to see where its lines end and whether the rest of the page stays out of the way. ".repeat(4).slice(0, 400);

const READ = `() => {
  const body = document.querySelector("[data-message-body]");
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;width:80ch;font-family:" + getComputedStyle(body).fontFamily + ";font-size:" + getComputedStyle(body).fontSize;
  body.parentElement.append(probe);
  const limit = probe.getBoundingClientRect().width;
  probe.remove();
  const range = document.createRange();
  range.selectNodeContents(body);
  const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  const control = body.nextElementSibling?.querySelector("button");
  return { width: body.getBoundingClientRect().width, limit, lines, shown: new Set([...range.getClientRects()].filter((rect) => rect.bottom <= body.getBoundingClientRect().bottom + 1).map((rect) => Math.round(rect.top))).size, control: control?.textContent ?? null };
}`;

type Read = { width: number; limit: number; lines: number; shown: number; control: string | null };

const save = async (name: string) => {
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

/** A cold dev server may reload the page once it has bundled its dependencies, or a loaded runner may stall it, so the page is loaded again when the rail has not come up. */
const openHarness = async () => {
  for (let attempt = 1; ; attempt++) {
    await page.load(`${real.base}/harness.html?daemon=1`, 1280, 800);

    try {
      await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`, 20_000);

      return;
    } catch (error) {
      if (attempt === 3) throw new Error(`${error instanceof Error ? error.message : String(error)}: ${await page.call<string>(`() => document.body.innerHTML.slice(0, 1500)`)}`);
    }
  }
};

run("u196 on the real Daemon", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u196_a_400_character_message_shows_two_lines_and_read_more_then_every_line_within_80ch", async () => {
    await openHarness();
    await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.includes("new Workstream")).click()`);
    await page.until(`() => { const door = [...document.querySelectorAll("button")].find((each) => /start Door/.test(each.textContent)); door?.click(); return Boolean(document.querySelector('[data-thread-input]')); }`);

    // The input is a controlled textarea: set it through the native setter, then the send button.
    await page.call(
      `(body) => {
        const input = document.querySelector('[data-thread-input]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, body);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }`,
      BODY,
    );
    await page.until(`() => document.querySelector(".thread-send")?.getAttribute("aria-disabled") !== "true"`);
    await page.call(`() => document.querySelector(".thread-send").click()`);
    await page.until(`() => Boolean(document.querySelector("[data-message-body]"))`);

    for (const [width, height] of [[1280, 800], [700, 800]] as const) {
      await page.resize(width, height);
      await page.until(`() => Boolean(document.querySelector(".thread-more button"))`);

      const closed = await page.call<Read>(READ);

      expect(closed.shown).toBe(2);
      expect(closed.control).toBe("read more");
      await save(`closed-${width}x${height}`);

      await page.call(`() => document.querySelector(".thread-more button").click()`);

      const open = await page.call<Read>(READ);

      expect(open.control).toBe("show less");
      expect(open.lines).toBeGreaterThan(2);
      expect(open.width).toBeLessThanOrEqual(open.limit + 1);
      await save(`open-${width}x${height}`);
      await page.call(`() => document.querySelector(".thread-more button").click()`);
    }
  });
});
