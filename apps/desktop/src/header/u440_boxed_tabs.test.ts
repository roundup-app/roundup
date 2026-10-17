import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir, readCapture } from "../testing/captures";
import type { Box, Observation } from "./u449Observation";
import { appServer, type AppServer } from "../testing/appServer";

// The scenario's existing rendered-page seam also observes the boxed tabs.
describe("u440 to u443 boxed tabs in isolated Chromium", () => {
  type Rect = Box & { width: number };

  type Tab = { box: Rect; name: Rect; tail: Rect; close: Rect; border: string; bottomBorder: string; pad: string; icons: number; mark: null | { box: Rect; radius: string; background: string; colour: string; children: number; label: string } };

  type Row = Observation & { rule: { width: string; colour: string; token: string }; tabs: Tab[]; rest?: string; markChanged?: string; hover?: string; selected?: string; paint?: { image: string; background: string; selected: string }; rename?: { field: Rect; tab: Rect; padding: string }; edges?: { box: Rect; mark: Rect }[] };

  let server: AppServer;
  let rows: Row[];
  let baseRows: Row[] = [];
  let baseServer: ViteDevServer | undefined;

  // The script walks three viewports one after another; each runs in its own browser, side by side, and the rows join in the script's order.
  const readBoxes = async (origin: string, variant: "head" | "base"): Promise<Row[]> => {
    const walks = ["1280x800", "1280x820", "1440x800"].map((viewport) => promisify(execFile)("python3", ["src/header/u449_browser.test.py", origin, captureDir("U440") ?? "", "", variant, "boxes", viewport], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 }));

    return (await Promise.all(walks)).flatMap(({ stdout }) => JSON.parse(stdout));
  };

  beforeAll(async () => {
    server = await appServer();
    rows = await readBoxes(server.resolvedUrls.local[0]!, "head");
    expect(rows.length).toBe(36);
    const baseRoot = process.env.U440_BASE_ROOT;

    if (baseRoot) {
      baseServer = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
      await baseServer.listen();
      baseRows = await readBoxes(baseServer.resolvedUrls!.local[0]!, "base");
    } else baseRows = rows.map(row => JSON.parse(readCapture("U440", `base/${row.case}.geometry.json`)));
  }, 1_200_000);
  afterAll(async () => { await server?.close(); await baseServer?.close(); });
  it("u2233_flat_tabs_pass_the_moved_checks", () => {
    expect(baseRows.length).toBe(rows.length);

    for (const row of rows) {
      const base = baseRows.find(base => base.case === row.case)!;

      for (const [id, reading] of Object.entries(base.checks)) if (reading.status === "pass") expect(row.checks[id]?.status, row.case + "/" + id).toBe("pass");
    }
  });
  it("u440_a_tab_has_no_project_icon", () => {
    for (const row of rows) for (const tab of row.tabs) expect(tab.icons, row.case).toBe(0);
  });});
