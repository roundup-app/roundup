import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** U364's observer: the real `rupd` with U356's ten Agents and a real Chromium; the `blocked` rows' `waits on #<id>` shows whole at 1600 by 800 and is cut at 1280 and 700. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U356");

// U356's seed: two Workstreams of five Agents each, one `blocked` in each.
// The Rail's width in px at which both labels fit whole at 1600 by 800 (U364's Given).
const WIDE = 400;

const KINDS = ["blocked", "working", "idle", "working", "idle", "error", "needs-you", "blocked", "error", "needs-you"];

beforeAll(async () => {
  if (!found) throw new Error("U364 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon(
    { FAKE_CLAUDE_KINDS: JSON.stringify(KINDS), FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }) },
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
  const checks = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(checks, null, 2));

  // U364 Unchanged: D1 to D11 hold.
  for (let each = 1; each <= 11; each++) expect(checks[`D${each}`]?.status, `D${each} at ${name}`).toBe("pass");
};

type Blocked = { label: string; scrollWidth: number; clientWidth: number };

const AGENTS = `[...document.querySelectorAll('[role="treeitem"][data-id][aria-level="2"]')]`;

/** A Live line shows on the selected row (RailRow), so each `blocked` Agent is selected by pointer and its row read. */
const READ = `async () => {
  const rows = ${AGENTS}.filter((row) => row.getAttribute("data-kind") === "blocked");
  const out = [];
  for (const row of rows) {
    row.querySelector(".name").click();
    for (let tries = 0; tries < 100 && !row.querySelector(".live-label"); tries++) await new Promise((done) => setTimeout(done, 20));
    const label = row.querySelector(".live-label");
    if (!label) throw new Error("no .live-label on a selected blocked row after 100 tries");
    out.push({ label: label.textContent, scrollWidth: label.scrollWidth, clientWidth: label.clientWidth });
  }
  return out;
}`;

const openHarness = async () => {
  for (let attempt = 1; ; attempt++) {
    await page.load(`${real.base}/harness.html?daemon=1`, 1600, 800);

    try {
      await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`, 20_000);

      return;
    } catch (error) {
      if (attempt === 3) throw new Error(`${error instanceof Error ? error.message : String(error)}: ${await page.call<string>(`() => document.body.innerHTML.slice(0, 1500)`)}`);
    }
  }
};

run("u364 on the real Daemon", () => {
  vi.setConfig({ testTimeout: 420_000 });

  it("u364_a_blocked_row_shows_its_whole_waits_on_label_at_1600_and_is_cut_at_1280_and_700", async () => {
    await openHarness();

    for (let workstream = 1; workstream <= 2; workstream++) {
      await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.includes("new Workstream")).click()`);
      await page.until(`() => document.querySelectorAll('[role="treeitem"][data-kind]').length > 0 && Boolean([...document.querySelectorAll("button")].find((each) => /start Door/.test(each.textContent)) || document.querySelector('[data-thread-input]'))`, 30_000);
      await page.until(`() => { const door = [...document.querySelectorAll("button")].find((each) => /start Door/.test(each.textContent)); if (door && !door.disabled) door.click(); return !door; }`, 60_000);

      for (let at = 1; at <= 5; at++) {
        const want = (workstream - 1) * 5 + at;

        await page.until(
          `() => { if (${AGENTS}.length < ${want}) [...document.querySelectorAll('[role="treeitem"]')].find((each) => each.getAttribute("aria-label") === "add agent")?.click(); return ${AGENTS}.length >= ${want}; }`,
          60_000,
        );
      }
    }

    // Each Agent plays its entry: both `blocked` Agents read `waits on #<id>`.
    await page.until(`() => ${AGENTS}.filter((row) => row.getAttribute("data-kind") === "blocked").length === 2 && ${AGENTS}.every((row) => row.getAttribute("data-kind") !== "starting")`, 90_000);

    await page.resize(1600, 800);

    // The Rail's default is 288 px (U389) and its row also holds the badge and name, so the whole label needs a wider Rail: the user's Resize edge widens it by key.
    const edge = (key: string) => page.call(`(key) => document.querySelector('[role="separator"][aria-label="resize Rail"]').dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))`, key);

    await page.until(`() => { const edge = document.querySelector('[role="separator"][aria-label="resize Rail"]'); if (Number(edge.getAttribute("aria-valuenow")) < ${WIDE}) edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); return Number(edge.getAttribute("aria-valuenow")) >= ${WIDE}; }`);

    const wide = await page.call<Blocked[]>(READ);

    expect(wide).toHaveLength(2);

    for (const row of wide) {
      expect(row.label).toMatch(/^waits on #\d+$/);
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    }

    await save("blocked-1600x800");

    // Back to the default Rail, as a user's Enter on the edge does.
    await edge("Enter");

    for (const [width, height] of [[1280, 800], [700, 800]] as const) {
      await page.resize(width, height);

      const narrow = await page.call<Blocked[]>(READ);

      expect(narrow).toHaveLength(2);

      await save(`blocked-${width}x${height}`);
    }
  });
});
