import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** U355's rendered observer: the real `rupd` and a real Chromium; a Door's Checkpoint draws at the top, the full log is a closed fold, and the card meets D2, D5 and D6. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U355");

const BLOCKS = [
  { kind: "rows", title: "Achieved", rows: [{ label: "tests", value: "green" }, { label: "gate", value: "just check" }] },
  { kind: "table", title: "Now", head: ["agent", "state"], rows: [["ann", "working"], ["bob", "idle"]] },
  { kind: "text", text: "watch the build" },
];

beforeAll(async () => {
  if (!found) throw new Error("U355 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({ FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "checkpoint_write", arguments: { title: "Tour done", blocks: BLOCKS } }) }, true);
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

  it("u355_the_door_writes_a_checkpoint_and_the_fold_holds_every_message", async () => {
    await openHarness();
    await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.includes("new Workstream")).click()`);
    await page.until(`() => { const door = [...document.querySelectorAll("button")].find((each) => /start Door/.test(each.textContent)); door?.click(); return Boolean(document.querySelector('[data-thread-input]')); }`);
    await page.call(
      `() => {
        const input = document.querySelector('[data-thread-input]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "go");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }`,
    );
    await page.until(`() => document.querySelector(".thread-send")?.getAttribute("aria-disabled") !== "true"`);
    await page.call(`() => document.querySelector(".thread-send").click()`);
    await page.until(`() => Boolean(document.querySelector("[data-checkpoint]"))`, 60_000);

    for (const [width, height] of [[1280, 800], [700, 800]] as const) {
      await page.resize(width, height);
      await page.call(`() => { document.querySelector("[data-log]").open = false; }`);
      expect(await page.call<number>(`() => document.querySelector("[data-checkpoint]").getBoundingClientRect().width <= document.querySelector(".thread-column").getBoundingClientRect().width ? 1 : 0`)).toBe(1);
      await save(`closed-${width}x${height}`);
      await page.call(`() => { document.querySelector("[data-log]").open = true; }`);
      await save(`open-${width}x${height}`);
    }

    const checks = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

    for (const id of ["D2", "D5", "D6"]) expect(checks[id]!.status).toBe("pass");
  });
});
