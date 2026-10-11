import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** U355's rendered observer: the real `rupd`, a Door whose fake `claude` writes a Checkpoint, and a real Chromium at 1280×800 and 700×800 with the full log closed and open. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U355");

beforeAll(async () => {
  if (!found) throw new Error("U355 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon(
    {
      FAKE_CLAUDE_ORDER_PROMPTS: "2",
      FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "checkpoint_write", arguments: { title: "Tests green", blocks: [{ kind: "rows", rows: [{ label: "build", value: "passes" }] }] } }),
    },
    true,
  );
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

const save = async (name: string) => {
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

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

run("u355 on the real Daemon", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u355_the_checkpoint_card_tops_the_thread_and_the_log_opens_at_both_widths", async () => {
    await openHarness();
    await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.includes("new Workstream")).click()`);
    await page.until(`() => { const door = [...document.querySelectorAll("button")].find((each) => /start Door/.test(each.textContent)); door?.click(); return Boolean(document.querySelector('[data-thread-input]')); }`);
    await page.call(
      `() => {
        const input = document.querySelector('[data-thread-input]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "ask");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }`,
    );
    await page.until(`() => document.querySelector(".thread-send")?.getAttribute("aria-disabled") !== "true"`, 60_000);
    await page.call(`() => document.querySelector(".thread-send").click()`);
    await page.until(`() => Boolean(document.querySelector("[data-checkpoints] [data-checkpoint]"))`, 60_000);

    for (const [width, height] of [[1280, 800], [700, 800]] as const) {
      await page.resize(width, height);
      expect(await page.call<boolean>(`() => !document.querySelector("[data-log]").open`)).toBe(true);
      await save(`closed-${width}x${height}`);
      await page.call(`() => document.querySelector("[data-log] > summary").click()`);
      expect(await page.call<boolean>(`() => document.querySelector("[data-log]").open`)).toBe(true);
      await save(`open-${width}x${height}`);
      await page.call(`() => document.querySelector("[data-log] > summary").click()`);
    }
  });
});
