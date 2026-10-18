import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { createServedApp, spawnPrompted } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** U364's observer: the real `rupd` with U356's ten Agents and a real Chromium; the `blocked` rows' `waits on #<id>` shows whole at 1600 by 800 and is cut at 1280 with the age whole. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

// U356's seed (fixtures/u356_blocked.json): two Workstreams of five Agents each, one `blocked` in each.
// The Rail's width in px at which both labels fit whole at 1600 by 800 (U364's Given).
const WIDE = 400;

beforeAll(async () => {
  if (!found) throw new Error("U364 needs a Chrome binary: set CHROME_PATH");

  // E10: U356's ten Agents, each Agent's turns chosen by its id; its Claude is the pinned one, its model aimock serving that file's turns.
  real = await startRealDaemon({}, true, undefined, join(process.cwd(), "src/testing/fixtures/u356_blocked.json"));
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

type Blocked = { label: string; live: number };

const AGENTS = `[...document.querySelectorAll('[data-part="item"][data-id][aria-level="2"]')]`;

/** U404: the Rail draws no Live line, so each `blocked` row's whole label is the Status line of its Tooltip (U521), */
const MEASURE = `() => ${AGENTS}.filter((row) => row.getAttribute("data-kind") === "blocked").map((row) => { const box = row.getBoundingClientRect(); return { id: row.dataset.id, live: row.querySelectorAll(".live, .live-label, .live-age").length, x: box.left + box.width / 2, y: box.top + box.height / 2 }; })`;

const TIP = `(id) => { const row = document.querySelector('.rail-row[data-id="' + id + '"]'); const lines = [...(document.getElementById(row.getAttribute("aria-describedby") ?? "")?.children ?? [])].map((line) => line.textContent); return lines.find((line) => line !== row.querySelector(".name").textContent) ?? ""; }`;

/** Each blocked row measured, then hovered as a user does so its Tooltip names the whole label (after the name, when the layout cuts it). */
const READ = async (): Promise<Blocked[]> => {
  const rows = await page.call<(Omit<Blocked, "label"> & { id: string; x: number; y: number })[]>(MEASURE);
  const read: Blocked[] = [];

  for (const { id, x, y, ...measured } of rows) {
    await page.hover(x, y);
    await page.until(`() => (${TIP})(${JSON.stringify(id)}) !== ""`);
    read.push({ ...measured, label: await page.call<string>(TIP, id) });
  }

  return read;
};

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

  it("u364_a_blocked_row_keeps_its_whole_waits_on_label_in_its_title_at_1600_and_1280", async () => {
    await openHarness();

    for (let workstream = 1; workstream <= 2; workstream++) {
      await page.call(`() => [...document.querySelectorAll("button")].find((each) => (each.getAttribute("aria-label") === "Add Workstream" || each.textContent.includes("New Workstream"))).click()`);
      await page.until(`() => document.querySelectorAll('.rail-row[data-kind]').length > 0 && Boolean([...document.querySelectorAll("button")].find((each) => /Start supervisor/i.test(each.textContent)) || document.querySelector('.pane-screen'))`, 30_000);
      await page.until(`() => { const door = [...document.querySelectorAll("button")].find((each) => /Start supervisor/i.test(each.textContent)); if (door && !door.disabled) door.click(); return !door; }`, 60_000);

      const app = createServedApp(real.base);
      const door = (await app.rpc("rail.tree", null)).filter((node) => node.kind === "workstream")[workstream - 1]!;

      for (let at = 1; at <= 5; at++) {
        await spawnPrompted(app, real.dir, door.id);
        await page.until(`() => ${AGENTS}.length >= ${(workstream - 1) * 5 + at}`, 60_000);
      }
    }

    // Each Agent plays its entry: both `blocked` Agents read `waits on #<id>`.
    await page.until(`() => ${AGENTS}.filter((row) => row.getAttribute("data-kind") === "blocked").length === 2 && ${AGENTS}.every((row) => row.getAttribute("data-kind") !== "starting")`, 90_000);

    await page.resize(1600, 800);

    // The Rail's default is 288 px (U389) and its row also holds the badge, name and age, so the whole label needs a wider Rail: the user's Resize edge widens it by key.
    const edge = async (key: string) => {
      await page.call(`() => document.querySelector('[role="separator"][aria-label="Resize Rail"]').focus()`);
      await page.press(key, key);
    };

    while (await page.call<number>(`() => Number(document.querySelector('[role="separator"][aria-label="Resize Rail"]').getAttribute("aria-valuenow"))`) < WIDE) await edge("ArrowRight");

    const wide = await READ();

    expect(wide).toHaveLength(2);

    for (const row of wide) {
      expect(row.label).toMatch(/^waits on #\d+$/);
      expect(row.live).toBe(0);
    }

    // Back to the default Rail, as a user's Enter on the edge does.
    await edge("Enter");

    for (const [width, height] of [[1280, 800]] as const) {
      await page.resize(width, height);

      const narrow = await READ();

      expect(narrow).toHaveLength(2);

      for (const row of narrow) {
        expect(row.label).toMatch(/^waits on #\d+$/);
        expect(row.live).toBe(0);
        }
    }

    await real.model!.assertMatched(2);
  });
});
