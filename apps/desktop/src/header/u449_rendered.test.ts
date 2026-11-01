import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { appServer, type AppServer } from "../testing/appServer";

type Box = { height: number; left: number; right: number; top: number; bottom: number };

type Frame = { top: number; bottom: number; barBottom: number };

type Observation = {
  case: string; width: number; bar: Box; reserved: Box; title: Box; strip: Box; plus: Box;
  rail: Box; centre: Box; shelf: Box; drawer: Box; close: Box;
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
  let server: AppServer | undefined;
  let cacheDir: string | undefined;
  let records: Observation[] = [];

  beforeAll(async () => {
    if (spawnSync("agent-browser", ["--version"], { timeout: 10_000 }).status !== 0) {
      throw new Error("U449 needs agent-browser for isolated headless Chromium");
    }

    cacheDir = mkdtempSync(join(tmpdir(), "u449-vite-"));
    server = await appServer();
    const origin = server.resolvedUrls?.local[0];

    if (!origin) throw new Error("U449 harness has no URL");

    const { stdout } = await promisify(execFile)("python3", ["src/header/u449_browser.test.py", origin, captureDir("U449") ?? "", captureDir("U451") ?? ""], {
      timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
    });

    records = JSON.parse(stdout);
    expect(records.length).toBeGreaterThan(40);
  }, 1_200_000);

  afterAll(async () => {
    await server?.close();

    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("u449_long_title_keeps_its_full_name", () => {
    for (const record of records.filter((record) => record.case.includes("overflow"))) {
      expect(record.titleText).toContain("W".repeat(300));
      expect(record.titleText).toBe(record.titleName);
      expect(record.titleText).toBe(record.titleTip);
    }
  });
});
