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
  opening?: Frame[]; closing?: Frame[];
  titleText: string; titleName: string; titleTip: string;
  titleStyle: { overflow: string; whiteSpace: string };
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

  it("u449_title_is_centred_independently_of_the_shelf", () => {
    for (const record of records) {
      expect(Math.abs((record.title.left + record.title.right) / 2 - record.width / 2)).toBeLessThanOrEqual(1);
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
      const base: Observation = JSON.parse(readCapture("U449", `base/${record.case}.checks.json`));
      const regressed = Object.entries(record.checks).filter(([id, check]) => check.status === "fail" && base.checks[id]?.status !== "fail");

      expect(regressed, record.case).toEqual([]);
    }
  });
});
