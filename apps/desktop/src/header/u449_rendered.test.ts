import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir, readCapture } from "../testing/captures";

type Box = { height: number; left: number; right: number; top: number; bottom: number };

type Frame = { top: number; bottom: number; barBottom: number };

type Observation = {
  case: string; width: number; bar: Box; reserved: Box; title: Box; strip: Box; plus: Box;
  rail: Box; centre: Box; shelf: Box; hide: Box | null; show: Box | null; drawer: Box; close: Box;
  menu: Box | null;
  centreSurfaces: Box[];
  opening?: Frame[]; closing?: Frame[];
  titleText: string; titleName: string; titleTip: string;
  titleTextWidth: number; titlePadding: number;
  titleStyle: { overflow: string; whiteSpace: string };
  controls: { name: string; box: Box; visible: boolean }[];
  scroll: { total: number; width: number };
  checks: Record<string, { status: string }>;
};

const run = captureDir("U449") ? describe : describe.skip;

run("u449 isolated rendered window bar", () => {
  let server: ViteDevServer | undefined;
  let cacheDir: string | undefined;
  let baselineServer: ViteDevServer | undefined;
  let records: Observation[] = [];

  beforeAll(async () => {
    if (spawnSync("agent-browser", ["--version"], { timeout: 10_000 }).status !== 0) {
      throw new Error("U449 needs agent-browser for isolated headless Chromium");
    }

    cacheDir = mkdtempSync(join(tmpdir(), "u449-vite-"));
    server = await createServer({ cacheDir, server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
    await server.listen();
    const origin = server.resolvedUrls?.local[0];

    if (!origin) throw new Error("U449 harness has no URL");

    const { stdout } = await promisify(execFile)("python3", ["src/header/u449_browser.test.py", origin, captureDir("U449") ?? "", captureDir("U451") ?? ""], {
      timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
    });

    const baseRoot = process.env.U449_BASE_ROOT;

    if (baseRoot) {
      baselineServer = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), cacheDir: join(cacheDir, "base"), server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
      await baselineServer.listen();
      const baseOrigin = baselineServer.resolvedUrls!.local[0]!;

      await promisify(execFile)("python3", ["src/header/u449_browser.test.py", baseOrigin, captureDir("U449") ?? "", "", "base"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
    }

    records = JSON.parse(stdout);
    expect(records.length).toBeGreaterThan(40);
  }, 1_200_000);

  afterAll(async () => {
    await server?.close();
    await baselineServer?.close();

    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("u449_one_bar_spans_the_window", () => {
    for (const record of records) {
      expect(record.bar.left).toBe(0);
      expect(record.bar.right).toBe(record.width);
      expect(record.bar.top).toBe(0);
    }
  });

  it("u449_regions_start_below_the_bar", () => {
    for (const record of records) {
      expect(record.rail.top).toBe(record.bar.bottom);
      expect(record.centre.top).toBe(record.bar.bottom);

      if (record.shelf.height > 0) expect(record.shelf.top).toBe(record.bar.bottom);
    }
  });

  it("u449_shelf_controls_stay_below_the_bar", () => {
    for (const record of records) {
      if (record.show) expect(record.show.top).toBeGreaterThanOrEqual(record.bar.bottom);

      if (record.hide && record.hide.height > 0) expect(record.hide.top).toBeGreaterThanOrEqual(record.bar.bottom);
    }
  });

  it("u449_show_shelf_never_covers_a_centre_card_or_pinned_bar", () => {
    const closed = records.filter((record) => record.show && record.centreSurfaces.length);
    expect(closed.some((record) => record.case.startsWith("decisions-"))).toBe(true);
    expect(closed.some((record) => record.case.endsWith("-closed-agent"))).toBe(true);

    for (const record of closed) for (const surface of record.centreSurfaces) {
      const show = record.show!;
      expect(surface.right <= show.left || surface.bottom <= show.top || surface.left >= show.right || surface.top >= show.bottom, record.case).toBe(true);
    }
  });

  it("u449_title_is_centred_independently_of_the_shelf", () => {
    for (const record of records) {
      expect(Math.abs((record.title.left + record.title.right) / 2 - record.width / 2)).toBeLessThanOrEqual(1);
    }
  });

  it("u449_a_short_title_leaves_the_remaining_bar_space_for_tabs", () => {
    const short = records.filter((record) => record.case.endsWith("-rest") && record.titleText.length < 32);
    expect(short.some((record) => record.case.startsWith("first-run-"))).toBe(true);

    for (const record of short) {
      expect(record.title.right - record.title.left, record.case).toBeLessThanOrEqual(record.titleTextWidth + record.titlePadding + 1);
      expect(Math.abs(record.strip.right - record.title.left), record.case).toBeLessThanOrEqual(1);
    }
  });

  it("u451_traffic_light_area_is_reserved", () => {
    for (const record of records) {
      expect(record.reserved.left).toBeLessThanOrEqual(8);
      expect(record.reserved.right).toBeGreaterThanOrEqual(96);
      expect(record.strip.left).toBeGreaterThanOrEqual(record.reserved.right);
    }
  });

  it("u449_strip_overflow_covers_neither_title_nor_traffic_lights", () => {
    for (const record of records) {
      expect(record.strip.right).toBeLessThanOrEqual(record.title.left);
      expect(record.plus.right).toBeLessThanOrEqual(record.title.left);

      if (record.case.includes("overflow")) expect(record.scroll.total).toBeGreaterThan(record.scroll.width);

      for (const tooltip of record.controls.filter((control) => control.name === "tab-tip")) {
        expect(tooltip.box.left).toBeGreaterThanOrEqual(record.reserved.right);
        expect(tooltip.box.top).toBeGreaterThanOrEqual(record.title.bottom);
      }
    }
  });

  it("u449_tab_menu_never_covers_the_bar", () => {
    for (const record of records.filter((record) => record.menu)) {
      expect(record.menu!.top).toBeGreaterThanOrEqual(record.bar.bottom);
    }
  });

  it("u449_long_title_keeps_its_full_name", () => {
    for (const record of records.filter((record) => record.case.includes("overflow"))) {
      expect(record.titleText).toContain("W".repeat(300));
      expect(record.titleText).toBe(record.titleName);
      expect(record.titleText).toBe(record.titleTip);
      expect(record.titleStyle).toEqual({ overflow: "ellipsis", whiteSpace: "nowrap" });
    }
  });

  it("u449_every_drawer_stays_below_the_bar", () => {
    for (const record of records.filter((record) => record.opening)) {
      expect(record.drawer.top).toBe(record.bar.bottom);
      expect(record.close.top).toBeGreaterThanOrEqual(record.bar.bottom);

      for (const frames of [record.opening!, record.closing!]) {
        expect(frames.length).toBeGreaterThan(2);

        for (const frame of frames) {
          expect(frame.top).toBe(frame.barBottom);
          expect(frame.bottom).toBe(800);
        }
      }
    }
  });

  it("u449_bar_uses_tokens_and_keeps_checks", () => {
    for (const record of records) {
      const base: Observation["checks"] = JSON.parse(readCapture("U449", `base/${record.case}.checks.json`));
      expect(JSON.parse(readCapture("U449", `head/${record.case}.checks.json`))).toEqual(record.checks);
      const regressed = Object.entries(record.checks).filter(([id, check]) => check.status === "fail" && base[id]?.status !== "fail");

      expect(regressed, record.case).toEqual([]);
    }
  });
});

// The scenario's existing rendered-page seam also observes the boxed tabs.
describe("u440 to u443 boxed tabs in isolated Chromium", () => {
  type Rect = Box & { width: number };

  type Tab = { box: Rect; name: Rect; tail: Rect; close: Rect; border: string; bottomBorder: string; pad: string; icons: number; mark: null | { box: Rect; radius: string; background: string; colour: string; children: number; label: string } };

  type Row = Observation & { rule: { width: string; colour: string; token: string }; tabs: Tab[]; rest?: string; markChanged?: string; hover?: string; selected?: string; paint?: { image: string; background: string; selected: string }; rename?: { field: Rect; tab: Rect; padding: string }; edges?: { box: Rect; mark: Rect }[] };

  let server: ViteDevServer;
  let rows: Row[];
  let baseRows: Row[] = [];
  let baseServer: ViteDevServer | undefined;
  beforeAll(async () => {
    server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
    await server.listen();
    const { stdout } = await promisify(execFile)("python3", ["src/header/u449_browser.test.py", server.resolvedUrls!.local[0]!, captureDir("U440") ?? "", "", "head", "boxes"], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
    rows = JSON.parse(stdout);
    expect(rows.length).toBe(36);
    const baseRoot = process.env.U440_BASE_ROOT;

    if (baseRoot) {
      baseServer = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
      await baseServer.listen();
      const base = await promisify(execFile)("python3", ["src/header/u449_browser.test.py", baseServer.resolvedUrls!.local[0]!, captureDir("U440") ?? "", "", "base", "boxes"], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
      baseRows = JSON.parse(base.stdout);
    } else baseRows = rows.map(row => JSON.parse(readCapture("U440", `base/${row.case}.geometry.json`)));
  }, 1_200_000);
  afterAll(async () => { await server?.close(); await baseServer?.close(); });
  const centre = (box: Box) => (box.top + box.bottom) / 2;
  it("u440_boxed_tabs_keep_passing_checks", () => {
    expect(baseRows.length).toBe(rows.length);

    for (const row of rows) {
      const base = baseRows.find(base => base.case === row.case)!;

      for (const [id, reading] of Object.entries(base.checks)) if (reading.status === "pass") expect(row.checks[id]?.status, row.case + "/" + id).toBe("pass");
    }
  });
  it("u440_a_tab_is_one_bordered_box", () => {
    for (const row of rows) for (const tab of row.tabs) {
      expect(tab.border, row.case).toBe("1px");
      expect(tab.bottomBorder).toBe("1px");
      expect(tab.name.left - tab.box.left).toBeGreaterThanOrEqual(4);
      expect(tab.box.right - tab.close.right).toBeGreaterThanOrEqual(4);
    }
  });
  it("u440_name_close_and_plus_share_a_centre_line", () => {
    for (const row of rows) for (const tab of row.tabs) for (const control of [tab.name, tab.close, row.plus]) expect(Math.abs(centre(control) - centre(tab.box)), row.case).toBeLessThanOrEqual(1);
  });
  it("u440_a_tab_has_no_project_icon", () => {
    for (const row of rows) for (const tab of row.tabs) expect(tab.icons, row.case).toBe(0);
  });
  it("u440_clip_overflow_and_rename_fit_the_box", () => {
    for (const row of rows) {
      for (const tab of row.tabs) expect(tab.name.height).toBeGreaterThanOrEqual(24);

      if (row.rename) {
        expect(row.rename.field.top).toBeGreaterThan(row.rename.tab.top);
        expect(row.rename.field.bottom).toBeLessThan(row.rename.tab.bottom);
        expect(row.rename.padding).toBe("4px");
      }

      for (const edge of row.edges ?? []) {
        expect(edge.box.top).toBeGreaterThanOrEqual(row.bar.top);
        expect(edge.box.bottom).toBe(row.bar.bottom);
        expect(edge.mark.width).toBe(8);
        expect(edge.mark.height).toBe(8);
        expect(edge.mark.left).toBeGreaterThan(edge.box.left);
        expect(edge.mark.right).toBeLessThan(edge.box.right);
      }
    }

    expect(rows.some(row => row.edges?.length)).toBe(true);
  });
  it("u441_hover_and_selection_move_no_other_tab", () => {
    for (const row of rows.filter(row => row.tabs.length)) {
      expect(JSON.parse(row.hover!), row.case).toEqual(JSON.parse(row.rest!));
      expect(JSON.parse(row.selected!), row.case).toEqual(JSON.parse(row.rest!));

      if (row.markChanged) expect(JSON.parse(row.markChanged), row.case).toEqual(JSON.parse(row.rest!));
    }
  });
  it("u441_hover_colours_the_whole_box", () => {
    for (const row of rows.filter(row => row.tabs.length)) {
      if (row.paint!.selected === "true") expect(row.paint!.background).toBe(row.case.endsWith("light") ? "rgb(250, 250, 250)" : "rgb(50, 50, 52)");
      else expect(row.paint!.image).toContain("linear-gradient");
    }
  });
  it("u442_a_hairline_runs_under_the_header", () => {
    for (const row of rows) {
      expect(row.rule.width).toBe("1px");
      expect(row.rule.colour).toBe(row.rule.token);

      for (const tab of row.tabs) expect(tab.box.bottom, row.case).toBe(row.bar.bottom);
    }
  });
  it("u442_the_rule_shows_with_no_project", () => {
    for (const row of rows.filter(row => !row.tabs.length)) {
      expect(row.bar.left).toBe(0);
      expect(row.bar.right).toBe(row.width);
    }
  });
  it("u443_the_mark_is_a_small_dot_by_the_name", () => {
    const tabs = rows.flatMap(row => row.tabs).filter(tab => tab.mark);
    expect(tabs.length).toBeGreaterThan(0);

    for (const tab of tabs) {
      const mark = tab.mark!;
      expect(mark.children).toBe(0);
      expect(mark.box.width).toBe(8);
      expect(mark.box.height).toBe(8);
      expect(mark.radius).toBe("6px");
      expect(mark.background).toBe(mark.colour);
      expect(mark.box.top).toBeLessThan(centre(tab.name));
      // Just after the name: one `--space-1` gap from its last character, whatever the name's length.
      expect(mark.box.left - tab.tail.right, "the dot follows the name").toBeLessThanOrEqual(5);
      expect(mark.box.right).toBeLessThanOrEqual(tab.name.right);
      expect(mark.box.right).toBeLessThan(tab.close.left);
      expect(["Error", "Needs you"]).toContain(mark.label);
    }
  });
});

describe("u440 overflow edges sit beside the tab list", () => {
  type Rect = { left: number; right: number };

  type Reading = { case: string; mask: string; list: Rect; revealed: Rect; selected: Rect; tabs: Rect[]; edges: Rect[] };

  let server: ViteDevServer;
  let readings: Reading[];

  beforeAll(async () => {
    server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
    await server.listen();
    const { stdout } = await promisify(execFile)("python3", ["src/header/u449_browser.test.py", server.resolvedUrls!.local[0]!, captureDir("U440") ?? "", "", "head", "edges"], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
    readings = JSON.parse(stdout);
  }, 1_200_000);
  afterAll(async () => { await server?.close(); });

  const meets = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right;

  it("u440_no_tab_meets_an_overflow_edge", () => {
    expect(readings.length).toBe(4);

    for (const reading of readings) {
      expect(reading.edges.length, reading.case).toBeGreaterThan(0);

      for (const edge of reading.edges) for (const tab of reading.tabs) {
        // A tab is only seen where the list shows it.
        const seen = { left: Math.max(tab.left, reading.list.left), right: Math.min(tab.right, reading.list.right) };
        expect(seen.left < seen.right && meets(seen, edge), reading.case).toBe(false);
      }
    }
  });
  it("u440_the_selected_tab_keeps_its_left_border_in_view", () => {
    for (const reading of readings) expect(reading.revealed.left, reading.case).toBeGreaterThanOrEqual(reading.list.left);
  });

  it("u440_uncut_end_borders_stay_in_the_masks_opaque_region", () => {
    for (const reading of readings) {
      // The computed gradients run from transparent at the edge to opaque at
      // the first px stop (and, for a two-sided mask, back to transparent).
      const ramp = Number(reading.mask.match(/rgb\([^)]*\) ([\d.]+)px/)?.[1] ?? 0);
      const leftRamp = reading.mask.includes("to right") ? ramp : 0;
      const rightRamp = reading.mask.includes("to left") || reading.mask.includes("calc(") ? ramp : 0;
      const tab = reading.case.endsWith("first") ? reading.tabs[0]! : reading.tabs.at(-1)!;

      if (reading.case.endsWith("first")) expect(tab.left, reading.case).toBeGreaterThanOrEqual(reading.list.left + leftRamp);
      else expect(tab.right, reading.case).toBeLessThanOrEqual(reading.list.right - rightRamp);
    }
  });

  it("u440_a_cut_tab_fades_into_its_edge", () => {
    const cut = readings.filter((reading) => reading.tabs.some((tab) => tab.left < reading.list.left || tab.right > reading.list.right));
    expect(cut.length).toBeGreaterThan(1);

    for (const reading of cut) {
      expect(reading.mask, reading.case).toContain("linear-gradient");
      expect(reading.mask, reading.case).toContain("rgba(0, 0, 0, 0)");
    }
  });
});
