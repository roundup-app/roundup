import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { createServer } from "vite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";

const runtime = { spawn: vi.fn(spawn), createServer: vi.fn(createServer) };

let home: string;

let before: Record<string, string>;

const fixtures: StartedDaemon[] = [];

/** Every path under `dir` with its bytes, so a test can prove the folder unchanged. */
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

/** The last Daemon launch: its Project, its `ROUNDUP_DATA_DIR` and the process. */
const lastLaunch = () => {
  const index = runtime.spawn.mock.calls.findLastIndex((call) => call[0].endsWith("/rupd"));
  const [, args, options] = runtime.spawn.mock.calls[index]!;
  const data = options.env?.ROUNDUP_DATA_DIR;

  expect(data).toBeTruthy();
  expect(isAbsolute(data!)).toBe(true);

  const child: ChildProcess = runtime.spawn.mock.results[index]!.value;

  return { project: args[0]!, data: data!, child };
};

/** Delays each signal to `child`, as a Daemon still finishing its writes would; a fixture that removes its data before the exit then fails. */
const slowToExit = (child: ChildProcess) => {
  const kill = child.kill.bind(child);

  child.kill = (signal) => {
    setTimeout(() => kill(signal), 500);

    return true;
  };
};

it("n5_fixture_data_is_private_and_survives_restart", async () => {
  const first = await open();
  const firstData = lastLaunch().data;
  const second = await open();
  const secondData = lastLaunch().data;

  expect([first.dataDir, second.dataDir]).toEqual([firstData, secondData]);
  expect(firstData).not.toBe(secondData);

  for (const fixture of [first, second]) {
    for (const data of [firstData, secondData]) expect(relative(fixture.dir, data).startsWith("..")).toBe(true);
  }

  for (const [fixture, title] of [[first, "first Todo"], [second, "second Todo"]] as const) {
    const app = createServedApp(fixture.base);

    await app.rpc("todo.create", { title, body: null, blockers: null });
    await fixture.restart();
    expect(lastLaunch().data).toBe(fixture.dataDir);
    expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toEqual([title]);
  }

  await first.stop();
  await second.stop();
  expect(await snapshot(home)).toEqual(before);
}, 60_000);

it("n5_fixture_rejects_data_redirection", async () => {
  const appData = join(home, "xdg", "dev.roundup.app");

  vi.stubEnv("ROUNDUP_DATA_DIR", appData);
  const fixture = await open({ ROUNDUP_DATA_DIR: appData });

  expect(lastLaunch().data).toBe(fixture.dataDir);
  expect(fixture.dataDir).not.toBe(appData);
  await createServedApp(fixture.base).rpc("todo.create", { title: "private Todo", body: null, blockers: null });
  await fixture.restart();
  expect(lastLaunch().data).toBe(fixture.dataDir);
  await fixture.stop();
  expect(await snapshot(home)).toEqual(before);
}, 60_000);

it("n5_fixture_cleans_data_after_stop_and_failed_start", async () => {
  const fixture = await open();
  let presentAtExit = false;

  slowToExit(fixture.daemon);
  fixture.daemon.once("exit", () => {
    presentAtExit = existsSync(fixture.dataDir);
  });
  await fixture.stop();
  expect(presentAtExit).toBe(true);
  expect(existsSync(fixture.dataDir)).toBe(false);
  expect(existsSync(fixture.dir)).toBe(false);

  // The Daemon serves, then the dev server fails to start.
  const failed = { project: "", data: "", cache: "", presentAtExit: false };

  runtime.createServer.mockImplementationOnce(async (config) => {
    const launch = lastLaunch();

    Object.assign(failed, { project: launch.project, data: launch.data, cache: config!.cacheDir! });
    slowToExit(launch.child);
    launch.child.once("exit", () => {
      failed.presentAtExit = existsSync(failed.data);
    });
    throw new Error("N5 failed server startup");
  });
  await expect(open()).rejects.toThrow("N5 failed server startup");
  expect(failed.presentAtExit).toBe(true);

  for (const folder of [failed.project, failed.data, failed.cache]) expect(existsSync(folder)).toBe(false);

  // The Daemon exits before serving: its socket path lies under a file.
  const early = { project: "", data: "", presentAtExit: false };

  runtime.spawn.mockImplementationOnce((command, args, options) => {
    const child = spawn(command, args, options);

    Object.assign(early, { project: args[0]!, data: options.env!.ROUNDUP_DATA_DIR! });
    child.once("exit", () => {
      early.presentAtExit = existsSync(early.data);
    });

    return child;
  });
  await expect(open({ RUPD_SOCKET: join(home, "xdg", "dev.roundup.app", "projects", "seed", "seed.db", "rupd.sock") })).rejects.toThrow("rupd exited before serving");
  expect(early.presentAtExit).toBe(true);
  expect(existsSync(early.data)).toBe(false);
  expect(existsSync(early.project)).toBe(false);
  expect(await snapshot(home)).toEqual(before);
}, 60_000);
