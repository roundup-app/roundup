import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { agentBrowserExecutable, chromePath } from "../testing/chromePage";
import { afterAll, beforeAll, expect, it } from "vitest";

// The real Layout, served by Vite in an isolated headless session.

const profile = mkdtempSync(join(tmpdir(), "u507-profile-"));

let server: Awaited<ReturnType<typeof createServer>>;

const session = `u507-layout-${process.pid}`;

const env = { ...process.env };

const executable = chromePath();

if (executable) env.AGENT_BROWSER_EXECUTABLE_PATH = executable;

const browser = (...args: string[]) => promisify(execFile)(agentBrowserExecutable, ["--session", session, "--profile", profile, ...args], { encoding: "utf8", timeout: 60_000, env }).then(result => result.stdout);

const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("--json", "eval", script)).data.result;

// Pane refits on the next frame after ResizeObserver/drag completion; Shelf
// placement schedules its first frame before its CSS animations are available.
const settle = () => evaluate(`(async () => {
  await new Promise(requestAnimationFrame);
  await Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches?.('.shelf, .columns, .drawer')).map(a => a.finished.catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()`);

beforeAll(async () => {
  server = await createServer({
    cacheDir: "node_modules/.vite-u507-layout",
    server: { port: 0, strictPort: false },
    plugins: [{
      name: "u507-layout-host",
      enforce: "pre",
      resolveId: (id, importer) => {
        if (id === "./seeds" && importer?.endsWith("/src/testing/harness.tsx")) return "\0u507-seeds.js";
      },
      load: (id) => id === "\0u507-seeds.js" ? `
export { SEEDS, isSeedName } from '/src/testing/seeds.ts';
import { seedApp as original } from '/src/testing/seeds.ts';
export const seedApp = (...args) => {
  const controls = original(...args);
  const tree = controls.app.handlers['rail.tree'];
  // CI5527a: retain the Workstream and its live Agent used by every action below,
  // instead of mounting tree-40's unrelated rows for each App load.
  controls.app.handlers['rail.tree'] = async (params) => (await tree(params)).filter(node => ['payments', 'agent-4'].includes(node.id));
  return controls;
};` : undefined,
    }],
  });

  await server.listen();
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally {
    await server?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

const openApp = async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?view=workstreams&items=1&tabs=1&seed=tree-40&view=workstreams&items=1`);
  await browser("wait", "--fn", "Boolean(window.__fake) && document.querySelectorAll('[role=separator]').length === 2");
  await settle();
};

it("u507_resizing_preserves_state", async () => {
  await openApp();
  await evaluate("localStorage.clear()");
  await openApp();
  await evaluate(`document.querySelector('.rail [data-id="payments"] .name').click()`);
  await browser("wait", ".pane-screen");
  await settle();
  const read = () => evaluate(`document.querySelector('.rail .rail-row[data-selected]').dataset.id`);
  expect(await read()).toBe("payments");
  await browser("mouse", "move", "288", "400");
  await browser("mouse", "down", "left");
  await browser("mouse", "move", "360", "400");
  await settle();
  await browser("mouse", "up", "left");
  await settle();
  expect(await read()).toBe("payments");
  await evaluate(`document.querySelector('.rail [data-id="agent-4"] .name').click()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await evaluate("window.__fake.app.calls.length=0");
  await browser("mouse", "move", "360", "400");
  await browser("mouse", "down", "left");
  await browser("mouse", "move", "416", "400");
  await settle();
  // The Terminal's single refit after a drag is proved with pressed buttons in `u502_resize_preserves_terminal_fit`; agent-browser moves carry none.
  await browser("mouse", "up", "left");
  await settle();
  expect(await evaluate("window.__fake.app.calls.filter(c=>!['terminal.resize','project.resources'].includes(c.method)).map(c=>c.method)")).toEqual([]);
  expect(await evaluate("document.querySelector('.rail .rail-row[data-selected]').dataset.id")).toBe("agent-4");
  await evaluate(`document.querySelector('.rail [data-id="payments"] .name').click()`);
  await browser("wait", ".pane-screen");
  expect(await read()).toBe("payments");
}, 180_000);
