import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir, readCapture } from "../testing/captures";
import type { Box, Observation } from "./u449Observation";

// The scenario's existing rendered-page seam also observes the boxed tabs.
describe("u440 to u443 boxed tabs in isolated Chromium", () => {
  type Rect = Box & { width: number };

  type Tab = { box: Rect; name: Rect; tail: Rect; close: Rect; border: string; bottomBorder: string; pad: string; icons: number; mark: null | { box: Rect; radius: string; background: string; colour: string; children: number; label: string } };

  type Row = Observation & { rule: { width: string; colour: string; token: string }; tabs: Tab[]; rest?: string; markChanged?: string; hover?: string; selected?: string; paint?: { image: string; background: string; selected: string }; rename?: { field: Rect; tab: Rect; padding: string }; edges?: { box: Rect; mark: Rect }[] };

  let server: ViteDevServer;
  let rows: Row[];
  let baseRows: Row[] = [];
  let baseServer: ViteDevServer | undefined;

  // The script walks three viewports one after another; each runs in its own browser, side by side, and the rows join in the script's order.
  const readBoxes = async (origin: string, variant: "head" | "base"): Promise<Row[]> => {
    const walks = ["1280x800", "1280x820", "1440x800"].map((viewport) => promisify(execFile)("python3", ["src/header/u449_browser.test.py", origin, captureDir("U440") ?? "", "", variant, "boxes", viewport], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 }));

    return (await Promise.all(walks)).flatMap(({ stdout }) => JSON.parse(stdout));
  };

  beforeAll(async () => {
    server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
    await server.listen();
    rows = await readBoxes(server.resolvedUrls!.local[0]!, "head");
    expect(rows.length).toBe(36);
    const baseRoot = process.env.U440_BASE_ROOT;

    if (baseRoot) {
      baseServer = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
      await baseServer.listen();
      baseRows = await readBoxes(baseServer.resolvedUrls!.local[0]!, "base");
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
  it("u440_the_window_title_shares_the_tabs_centre_line", () => {
    for (const row of rows) expect(Math.abs(centre(row.title) - centre(row.plus)), row.case).toBeLessThanOrEqual(1);
  });
  it("u440_tabs_hang_a_step_below_the_window_top", () => {
    for (const row of rows) for (const tab of row.tabs) expect(tab.box.top - row.bar.top, row.case).toBeGreaterThanOrEqual(8);
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
        // The cap's content sits a step inside its 1 px border, not on it.
        expect(Math.min(edge.mark.left - edge.box.left, edge.box.right - edge.mark.right)).toBeGreaterThanOrEqual(5);
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
