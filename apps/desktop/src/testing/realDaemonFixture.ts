import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configure } from "@testing-library/dom";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { realDaemon } from "./realDaemonPlugin";
import { claudeBin, configureClaude, startModel, takeSlot } from "./realModel";
import type { Model } from "./realModel";

const REPO = resolve(process.cwd(), "../..");

export const PROOF = "0".repeat(64);

/** A running `rupd` of a fresh Project and the dev server that serves it to the harness page (U144, U146). */
export type StartedDaemon = { daemon: ChildProcess; dir: string; dataDir: string; base: string; model?: Model | undefined; restart: () => Promise<void>; stop: () => Promise<void> };

const served = async (base: string) => {
  for (let tries = 0; tries < 300; tries += 1) {
    const response = await fetch(`${base}/__daemon/open`).catch(() => null);

    if (response?.ok) return;
    await new Promise((done) => setTimeout(done, 100));
  }

  throw new Error("the dev server never served the Daemon routes");
};

const LOCK = join(tmpdir(), "roundup-cargo-build.lock");

/** Workers build in parallel and a fresh toolchain installs itself on first use, so one worker at a time builds. */
const buildOnce = async () => {
  for (;;) {
    try {
      await mkdir(LOCK);
      break;
    } catch {
      const age = await stat(LOCK).then((lock) => Date.now() - lock.mtimeMs, () => 0);

      if (age > 600_000) await rm(LOCK, { recursive: true, force: true });
      await new Promise((done) => setTimeout(done, 200));
    }
  }

  try {
    const build = () => spawnSync("cargo", ["build", "-p", "rupd", "-p", "rup"], { cwd: REPO, stdio: "inherit" });

    if (build().status !== 0 && build().status !== 0) throw new Error("cargo build -p rupd -p rup failed");
  } finally {
    await rm(LOCK, { recursive: true, force: true });
  }
};

/** Ends `child` and settles once it has exited, so a folder removed afterwards takes no more writes from it. */
const ended = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise<void>((done) => {
        child.once("exit", () => done());
        child.kill();
      });

/** A wait on a real Daemon reply outlasts a slow runner, so the default 1000 ms of `waitFor` and `findBy` never decides it. */
const DAEMON_WAIT_MS = 20_000;

/** How the fixture launches the Daemon and the dev server; N5 watches both. */
type FixtureRuntime = { spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess; createServer: typeof createServer };

/** Starts `rupd` on the fake `claude` with `env` added to its environment, as `just harness-real` does; `inBrowser` lets the dev server bundle dependencies for a real browser page. With `fixture` (E10), `rupd` starts the pinned Claude Code against aimock serving that file's turns, one of four real-Claude slots (E14) held until `stop`. */
export const startRealDaemon = async (env: Record<string, string>, inBrowser = false, runtime: FixtureRuntime = { spawn, createServer }, fixture?: string): Promise<StartedDaemon> => {
  configure({ asyncUtilTimeout: DAEMON_WAIT_MS });
  await buildOnce();

  const dir = await mkdtemp(join(tmpdir(), "roundup-real-"));
  // N5: the Daemon's data is this fixture's own folder, outside its Project; no caller environment redirects it.
  const dataDir = await mkdtemp(join(resolve(tmpdir()), "roundup-real-data-"));
  const socket = join(dir, "rupd.sock");
  let model: Model | undefined;
  let release: (() => Promise<void>) | undefined;
  let daemon: ChildProcess | undefined;
  let server: ViteDevServer | undefined;
  let cacheDir: string | undefined;
  let stopped: Promise<void> | undefined;

  const stop = () =>
    (stopped ??= (async () => {
      if (daemon) await ended(daemon);
      await server?.close();
      await model?.stop();
      await release?.();

      for (const folder of [cacheDir, dataDir, dir]) if (folder) await rm(folder, { recursive: true, force: true });
    })());

  let launch = {};

  const start = async () => {
    const child = runtime.spawn(join(REPO, "target/debug/rupd"), [dir, "--attached"], {
      env: {
        ...process.env,
        RUPD_SOCKET: socket,
        CLAUDE_CONFIG_DIR: join(dir, "claude-config"),
        ROUNDUP_RUP_BIN: join(REPO, "target/debug/rup"),
        ROUNDUP_CLAUDE_BIN: join(REPO, "crates/rup/tests/e2e/fake_claude.py"),
        ...launch,
        ...env,
        ROUNDUP_DATA_DIR: dataDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    daemon = child;
    // A Daemon that exits at once closes its stdin; the wait below reports that exit.
    child.stdin!.on("error", () => {});
    child.stdin!.write(`roundup-proof 1 ${PROOF}\n`);
    await new Promise<void>((serving, fail) => {
      child.stderr!.on("data", (chunk: Buffer) => chunk.toString().includes("serving") && serving());
      child.on("exit", () => fail(new Error("rupd exited before serving")));
    });
  };

  let base: string;

  try {
    if (fixture) {
      release = await takeSlot();
      model = await startModel(fixture);
      await mkdir(join(dir, "home"));
      await configureClaude(join(dir, "claude-config"), dir, model.url);
      launch = { ROUNDUP_CLAUDE_BIN: claudeBin(), HOME: join(dir, "home"), CLAUDE_CODE_OAUTH_TOKEN: "" };
    }

    await start();

    // Its own cache: servers sharing node_modules/.vite/deps delete one another's on start.
    cacheDir = await mkdtemp(join(tmpdir(), "vite-cache-"));

    server = await runtime.createServer({
      configFile: join(process.cwd(), "vite.config.ts"),
      root: process.cwd(),
      cacheDir,
      logLevel: "silent",
      plugins: [realDaemon({ project: dir, socket, proof: PROOF })],
      server: { host: "127.0.0.1", port: 0 },
      // A real browser page needs the bundled dependencies; the jsdom tests do not.
      optimizeDeps: inBrowser ? {} : { noDiscovery: true, include: [] },
    });

    await server.listen();
    base = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
    await served(base);
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    get daemon() {
      return daemon!;
    },
    dir,
    dataDir,
    base,
    model,
    // U177: the Daemon ends and a new one serves the same Project on the same socket.
    restart: async () => {
      await ended(daemon!);
      await start();
    },
    stop,
  };
};
