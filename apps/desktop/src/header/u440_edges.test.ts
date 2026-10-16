import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir } from "../testing/captures";

describe("u440 overflow edges sit beside the tab list", () => {
  type Rect = { left: number; right: number; bottom: number };

  type Reading = { case: string; cuts: { start: number; end: number; mask: string }; slots: number; list: Rect; revealed: Rect; selected: Rect; tabs: Rect[]; edges: Rect[] };

  let server: ViteDevServer;
  let readings: Reading[];
  let tight: { list: Rect; cuts: { start: number; end: number }; selected: Rect };

  beforeAll(async () => {
    server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
    await server.listen();
    const { stdout } = await promisify(execFile)("python3", ["src/header/u449_browser.test.py", server.resolvedUrls!.local[0]!, captureDir("U440") ?? "", "", "head", "edges"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
    ({ readings, tight } = JSON.parse(stdout));
  }, 1_200_000);
  afterAll(async () => { await server?.close(); });

  const meets = (a: Pick<Rect, "left" | "right">, b: Pick<Rect, "left" | "right">) => a.left < b.right && b.left < a.right;

  it("u440_no_tab_meets_an_overflow_edge", () => {
    expect(readings.length).toBe(9);

    for (const reading of readings) {
      expect(reading.edges.length, reading.case).toBeGreaterThan(0);

      for (const edge of reading.edges) for (const tab of reading.tabs) {
        // A tab is only seen where the list shows it.
        const seen = { left: Math.max(tab.left, reading.list.left), right: Math.min(tab.right, reading.list.right) };
        expect(seen.left < seen.right && meets(seen, edge), reading.case).toBe(false);
      }

      // One step of ground between a cap and the list, as between two tabs.
      for (const edge of reading.edges) expect(Math.min(Math.abs(reading.list.left - edge.right), Math.abs(edge.left - reading.list.right)), reading.case).toBeGreaterThanOrEqual(3.5);
    }
  });
  it("u440_the_selected_tab_keeps_its_left_border_in_view", () => {
    for (const reading of readings) expect(reading.revealed.left, reading.case).toBeGreaterThanOrEqual(reading.list.left);
  });

  it("u440_the_revealed_tab_keeps_its_right_border_when_it_fits", () => {
    for (const reading of readings) if (reading.list.right - reading.list.left >= reading.revealed.right - reading.revealed.left) expect(reading.revealed.right, reading.case).toBeLessThanOrEqual(reading.list.right + 0.5);
  });

  it("u440_a_slot_exists_only_beside_a_cap", () => {
    for (const reading of readings) expect(reading.slots, reading.case).toBe(reading.edges.length);
  });

  it("u440_a_list_barely_wider_than_a_tab_still_shows_the_open_tab", () => {
    // The list is narrower than the open tab, so the tab is cut; no fade may take it.
    expect(tight.list.right - tight.list.left).toBeLessThan(tight.selected.right - tight.selected.left + 1);

    if (tight.selected.left < tight.list.left - 0.5) expect(tight.cuts.start).toBe(0);

    if (tight.selected.right > tight.list.right + 0.5) expect(tight.cuts.end).toBe(0);
  });

  it("u440_only_a_cut_side_fades_across_the_whole_piece", () => {

    // The open tab is never covered, so a cut of it (the list barely wider than one tab) is not a cut here.
    const isOpen = (reading: Reading, tab: Rect) => Math.abs(tab.left - reading.selected.left) < 0.5 && Math.abs(tab.right - reading.selected.right) < 0.5;

    const cuts = (reading: Reading) => ({
      start: reading.tabs.filter((tab) => tab.left < reading.list.left - 0.5 && tab.right > reading.list.left + 0.5 && !isOpen(reading, tab)),
      end: reading.tabs.filter((tab) => tab.left < reading.list.right - 0.5 && tab.right > reading.list.right + 0.5 && !isOpen(reading, tab)),
    });

    expect(readings.some((reading) => cuts(reading).start.length > 0)).toBe(true);
    expect(readings.some((reading) => cuts(reading).end.length > 0)).toBe(true);

    for (const reading of readings) {
      const { start, end } = cuts(reading);

      // An uncut end keeps its border; a cut one fades across exactly the piece of the tab that shows.
      expect(reading.cuts.start, reading.case).toBeCloseTo(start.length > 0 ? start[0]!.right - reading.list.left : 0, 0);
      expect(reading.cuts.end, reading.case).toBeCloseTo(end.length > 0 ? reading.list.right - end[0]!.left : 0, 0);

      if (start.length + end.length > 0) expect(reading.cuts.mask, reading.case).toContain("linear-gradient");
    }
  });
});
