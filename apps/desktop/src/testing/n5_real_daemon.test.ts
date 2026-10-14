import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";

const runtime = { spawn: vi.fn(spawn), createServer: vi.fn(createServer) };

let home: string;

let before: Record<string, string>;

const fixtures: StartedDaemon[] = [];

const snapshot = async (dir: string): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      result[`${entry.name}/`] = "directory";

      for (const [name, bytes] of Object.entries(await snapshot(path))) result[`${entry.name}/${name}`] = bytes;
    } else result[entry.name] = (await readFile(path)).toString("hex");
  }

  return result;
};

beforeEach(async () => {
  runtime.spawn.mockClear();
  home = await mkdtemp(join(tmpdir(), "n5-home-"));

  for (const base of ["Library/Application Support", ".local/share", "xdg"]) {
    const dir = join(home, base, "dev.roundup.app", "projects", "seed");

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "seed.db"), Buffer.from([0, 255, 17, 42]));
  }

  before = await snapshot(home);
});

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.stop();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const open = async (env: Record<string, string> = {}) => {
  const fixture = await startRealDaemon({ HOME: home, XDG_DATA_HOME: join(home, "xdg"), ...env }, false, runtime);

  fixtures.push(fixture);

  return fixture;
};

const dataPath = () => {
  const path = runtime.spawn.mock.calls.findLast((call) => String(call[0]).endsWith("/rupd"))?.[2]?.env?.ROUNDUP_DATA_DIR;

  expect(path).toBeTruthy();
  expect(isAbsolute(path!)).toBe(true);

  return path!;
};

it("n5_fixture_data_is_private_and_survives_restart", async () => {
  const first = await open();
  const firstData = dataPath();

  expect(first.dataDir).toBe(firstData);
  const second = await open();
  const secondData = dataPath();

  expect(second.dataDir).toBe(secondData);

  expect(firstData).not.toBe(secondData);

  for (const fixture of [first, second]) {
    for (const data of [firstData, secondData]) expect(relative(fixture.dir, data).startsWith("..")).toBe(true);
  }

  for (const [fixture, title] of [[first, "first Todo"], [second, "second Todo"]] as const) {
    const app = createServedApp(fixture.base);

    await app.rpc("todo.create", { title, body: null, blockers: null });
    await fixture.restart();
    expect(dataPath()).toBe(fixture === first ? firstData : secondData);
    expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toEqual([title]);
  }

  await first.stop();
  await second.stop();
  expect(await snapshot(home)).toEqual(before);
}, 120_000);

it("n5_fixture_rejects_data_redirection", async () => {
  const appData = join(home, "xdg", "dev.roundup.app");
  vi.stubEnv("ROUNDUP_DATA_DIR", appData);
  const fixture = await open({ ROUNDUP_DATA_DIR: appData });

  expect(dataPath()).not.toBe(appData);
  await createServedApp(fixture.base).rpc("todo.create", { title: "private Todo", body: null, blockers: null });
  await fixture.restart();
  expect(dataPath()).not.toBe(appData);
  await fixture.stop();
  expect(await snapshot(home)).toEqual(before);
}, 120_000);

it("n5_fixture_cleans_data_after_stop_and_failed_start", async () => {
  const fixture = await open();
  const data = dataPath();
  let presentAtExit = false;

  fixture.daemon.once("exit", () => { presentAtExit = existsSync(data); });
  await fixture.stop();
  expect(presentAtExit).toBe(true);
  expect(fixture.daemon.exitCode !== null || fixture.daemon.signalCode !== null).toBe(true);
  expect(existsSync(data)).toBe(false);
  expect(existsSync(fixture.dir)).toBe(false);

  let failedData = "";
  let failedProject = "";
  let failedCache = "";
  let failedPresentAtExit = false;

  runtime.createServer.mockImplementationOnce(async (config) => {
    failedCache = config!.cacheDir!;
    failedData = dataPath();
    const index = runtime.spawn.mock.calls.findLastIndex((call) => String(call[0]).endsWith("/rupd"));
    const call = runtime.spawn.mock.calls[index]!;
    const child = runtime.spawn.mock.results[index]!.value;

    failedProject = call[1]![0]!;
    child.once("exit", () => { failedPresentAtExit = existsSync(failedData); });
    throw new Error("N5 failed server startup");
  });
  await expect(open()).rejects.toThrow("N5 failed server startup");
  expect(failedPresentAtExit).toBe(true);
  expect(existsSync(failedData)).toBe(false);
  expect(existsSync(failedProject)).toBe(false);
  expect(existsSync(failedCache)).toBe(false);

  let earlyData = "";
  let earlyProject = "";
  let earlyPresentAtExit = false;

  runtime.spawn.mockImplementationOnce((command, args, options) => {
    earlyData = options!.env!.ROUNDUP_DATA_DIR!;
    earlyProject = args[0]!;
    const child = spawn(command, args, options);

    child.once("exit", () => { earlyPresentAtExit = existsSync(earlyData); });

    return child;
  });
  await expect(open({ RUPD_SOCKET: join(home, "xdg", "dev.roundup.app", "projects", "seed", "seed.db", "rupd.sock") })).rejects.toThrow("rupd exited before serving");
  expect(earlyPresentAtExit).toBe(true);
  expect(existsSync(earlyData)).toBe(false);
  expect(existsSync(earlyProject)).toBe(false);
  expect(await snapshot(home)).toEqual(before);
}, 120_000);
