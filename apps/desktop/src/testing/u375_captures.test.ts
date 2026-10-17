import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";
import { captureDir } from "./captures";

/** U375's rendered observer: the real `rupd`, a Subagent selected in Watch and then in a Takeover, in a real Chromium at 1280×800. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

const ART = captureDir("U375");

beforeAll(async () => {
  if (!found) throw new Error("U375 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({}, true);
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

const save = async (name: string) => {
  if (!ART) return;
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

run("u375 on the real Daemon", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u375_a_subagent_shows_the_watch_band_and_then_the_takeover_band_at_both_widths", async () => {
    const app = createServedApp(real.base);

    await app.rpc("rail.createWorkstream", { name: "scope", parent: null });

    const door = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")!;
    const sub = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: door.id });

    await page.load(`${real.base}/harness.html?daemon=1`, 1280, 800);
    await page.until(`() => [...document.querySelectorAll("*")].some((each) => each.children.length === 0 && each.textContent.trim() === ${JSON.stringify(sub.name)})`, 30_000);
    await page.call(`(name) => [...document.querySelectorAll("*")].filter((each) => each.children.length === 0 && each.textContent.trim() === name).at(-1).click()`, sub.name);
    await page.until(`() => /Watching .*: Read-only/.test(document.body.textContent)`, 30_000);

    const terminal = sub.terminal_id!;
    const received = async () => (await app.rpc("terminal.snapshot", { id: terminal })).after;
    const before = await received();

    for (const [key, code] of [["h", "KeyH"], ["i", "KeyI"], ["Enter", "Enter"]] as const) await page.press(key, code);

    await new Promise((done) => setTimeout(done, 2_000));
    expect(await received()).toBe(before);

    for (const [width, height] of [[1280, 800]] as const) {
      await page.resize(width, height);
      await save(`watch-${width}x${height}`);
    }

    await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.trim().startsWith("Take control")).click()`);
    await page.until(`() => /Control: Typing goes straight to/.test(document.body.textContent)`, 30_000);
    expect(await page.call<boolean>(`() => !/read-only/.test(document.body.textContent)`)).toBe(true);

    const watched = await received();

    for (const [key, code] of [["h", "KeyH"], ["i", "KeyI"], ["Enter", "Enter"]] as const) await page.press(key, code);

    for (let waited = 0; (await received()) === watched; waited += 250) {
      if (waited >= 15_000) throw new Error("the Subagent's Terminal received nothing after the control");

      await new Promise((done) => setTimeout(done, 250));
    }

    for (const [width, height] of [[1280, 800]] as const) {
      await page.resize(width, height);
      await save(`takeover-${width}x${height}`);
    }
  });
});
