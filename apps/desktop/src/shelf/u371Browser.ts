import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { afterAll, beforeAll } from "vitest";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

type Server = Awaited<ReturnType<typeof createServer>>;

interface Servers {
  server: AppServer;
  main: Server | undefined;
}

/**
 * The real App on a Vite server and one agent-browser session, for the U369/U371 browser tests. Each test file calls it
 * once at its top level (it registers the file's hooks), so the sequencer can give each file to its own shard slot.
 */
export function shelfBrowser() {
  const profile = mkdtempSync(join(tmpdir(), "u371-browser-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "u371-vite-"));
  const session = `u371-${basename(profile)}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
  const rig: Servers = { server: undefined!, main: undefined };

  beforeAll(async () => {
    rig.server = await appServer();

    const root = process.env["ROUNDUP_U371_MAIN"];

    if (root) {
      rig.main = await createServer({ root, cacheDir: join(cacheDir, "main"), server: { port: 0, hmr: false }, logLevel: "silent" });
      await rig.main.listen();
    }
  }, 90_000);

  afterAll(async () => {
    await browser("close");
    await rig.server?.close();
    await rig.main?.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // ResizeObserver delivers geometry before the next paint; frame.toggle flushes the
  // hidden Shelf before showing it, and Pane refits on the next frame after settling.
  const settle = () => evaluate(`(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches?.('.shelf, .shelf-scrim, .columns, .drawer')).map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);

  const openShelf = async (seed = "tree-40", rail = 288, shelf = 320, width = 1280, scheme = "light", origin = rig.server.resolvedUrls.local[0]) => {
    await browser("set", "viewport", String(width), "800");
    await browser("set", "media", scheme);
    const url = `${origin}harness.html?seed=${seed}`;
    await browser("open", url);
    await browser("wait", ".window");
    await evaluate(`(() => { localStorage.clear(); localStorage.setItem('roundup:widths:/Users/you/harness', JSON.stringify({rail:${rail}, shelf:${shelf}})); return true; })()`);
    await browser("open", url);
    await browser("wait", seed === "first-run" ? ".window" : ".shelf-tabs");
    await settle();
  };

  const toggle = async () => {
    await evaluate(`(() => { document.querySelector('[aria-label="Hide work items"], [aria-label="Show work items"]').click(); return true; })()`);
    await settle();
  };

  const capture = async (id: string, step: string, side = "head") => {
    const dir = captureDir(id);

    if (!dir) return;
    mkdirSync(join(dir, side), { recursive: true });
    writeFileSync(join(dir, side, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, side, `${step}.png`));
  };

  return { rig, browser, evaluate, settle, openShelf, toggle, capture };
}
