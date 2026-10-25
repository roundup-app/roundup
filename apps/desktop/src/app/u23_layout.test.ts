import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { chromePath } from "../testing/chromePage";
import { afterAll, beforeAll, expect, it } from "vitest";

// The real Layout plus installed Ark, served by Vite in an isolated headless session.

const profile = mkdtempSync(join(tmpdir(), "u507-profile-"));

let server: Awaited<ReturnType<typeof createServer>>;

const session = `u507-layout-${process.pid}`;

const env = { ...process.env };

const executable = chromePath();

if (executable) env.AGENT_BROWSER_EXECUTABLE_PATH = executable;

const browser = (...args: string[]) => promisify(execFile)("agent-browser", ["--session", session, "--profile", profile, ...args], { encoding: "utf8", timeout: 60_000, env }).then(result => result.stdout);

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
      // Supply the public Layout props at the App composition site without
      // replacing Layout, its children, width controls or Terminal implementation.
      enforce: "pre",
      resolveId: (id, importer) => id === "./app/Layout" && importer?.endsWith("/src/App.tsx") ? "/u507-bound-layout.js" : undefined,
      load: (id) => id === "/u507-bound-layout.js" ? `
import { createComponent, mergeProps } from 'solid-js';
import { useSplitter } from '@ark-ui/solid/splitter';
import { Layout as RealLayout } from '/src/app/Layout.tsx';
export const Layout = (props) => {
  const bound = new URL(location.href).searchParams.has('bound');
  const api = useSplitter(() => ({ id: 'u507-app', panels: [{id:'rail'}, {id:'centre'}, {id:'shelf'}], defaultSize: [22.5,52.5,25] }));
  return createComponent(RealLayout, mergeProps(props, { get splitter() {
    return bound ? {root:api().getRootProps(), rail:api().getPanelProps({id:'rail'}), centre:api().getPanelProps({id:'centre'}), shelf:api().getPanelProps({id:'shelf'})} : undefined;
  }}));
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

const openApp = async (bound = true) => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tree-40&view=workstreams&items=1${bound ? "&bound=1" : ""}`);
  await browser("wait", "--fn", "Boolean(window.__fake) && document.querySelectorAll('[role=separator]').length === 2");
  await settle();
  expect(await evaluate(`document.querySelector('[data-layout-root]').dataset.scope === 'splitter'`)).toBe(bound);

  if (bound) expect(await evaluate(`document.querySelectorAll('[data-part=panel][data-ownedby]').length`)).toBe(3);
};

it("u507_bindings_preserve_resize_state", async () => {
  await openApp();
  await evaluate("localStorage.clear()");
  await openApp();
  await evaluate(`document.querySelector('.rail [data-id="payments"] .name').click()`);
  await browser("wait", ".pane-screen");
  await settle();
  const read = () => evaluate(`document.querySelector('.rail [aria-selected=true]').dataset.id`);
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
  expect(await evaluate("document.querySelector('.rail [aria-selected=true]').dataset.id")).toBe("agent-4");
  await evaluate(`document.querySelector('.rail [data-id="payments"] .name').click()`);
  await browser("wait", ".pane-screen");
  expect(await read()).toBe("payments");
}, 180_000);
