import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { promisify } from "node:util";
import { createServer } from "vite";
import { chromePath, FULLSCREEN } from "../testing/chromePage";
import { afterAll, beforeAll, expect, it } from "vitest";

// The real Layout plus installed Ark, served by Vite in an isolated headless session.

const profile = mkdtempSync(join(tmpdir(), "u507-profile-"));

let server: Awaited<ReturnType<typeof createServer>>;

let main: Awaited<ReturnType<typeof createServer>> | undefined;

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
      // Prospective #1997 consumer: use the installed shared List/Trigger,
      // retaining the actual Strip's rename, marks, close, overflow and chords.
      // No App, Layout or Project-content replacement is involved.
      transform: { order: "pre", handler(source, id) {
        if (id.endsWith("/header/Strip.tsx") && !source.includes("<Tabs.List")) return source
          .replace('import { copy }', 'import { Tabs } from "../ui/Tabs";\nconst TabList = (props: Parameters<typeof Tabs.List>[0]) => new URL(location.href).searchParams.has("tabs") ? <Tabs.List {...props} /> : <div {...props} />;\nimport { copy }')
          .replace('<div class="tablist"', '<TabList class="tablist"')
          .replace('        </div>\n        {edge(copy.right', '        </TabList>\n        {edge(copy.right');

        if (id.endsWith("/header/ProjectTab.tsx") && !source.includes("<Tabs.Trigger")) return source
          .replace('import { copy }', 'import { Tabs } from "../ui/Tabs";\nconst ProjectTrigger = (props: Parameters<typeof Tabs.Trigger>[0]) => new URL(location.href).searchParams.has("tabs") ? <Tabs.Trigger {...props} /> : <button {...props} />;\nimport { copy }')
          .replace('<button data-button="quiet"\n          type="button"\n          role="tab"', '<ProjectTrigger value={props.tab.path} data-button="quiet"\n          type="button"\n          role="tab"')
          .replace('        </button>\n        <button data-button="icon"', '        </ProjectTrigger>\n        <button data-button="icon"');
      } },
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
  const root = process.env["ROUNDUP_U507_MAIN"];

  if (root) {
    main = await createServer({ root, cacheDir: "node_modules/.vite-u507-main", server: { port: 0, hmr: false } });
    await main.listen();
  }
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally {
    await server?.close();
    await main?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

const openApp = async (bound = true) => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tree-40${bound ? "&bound=1" : ""}`);
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
  // The Terminal's single refit after a drag is proved with held buttons in `u502_resize_preserves_terminal_fit`; agent-browser moves carry none.
  await browser("mouse", "up", "left");
  await settle();
  expect(await evaluate("window.__fake.app.calls.filter(c=>!['terminal.resize','project.resources'].includes(c.method)).map(c=>c.method)")).toEqual([]);
  expect(await evaluate("document.querySelector('.rail [aria-selected=true]').dataset.id")).toBe("agent-4");
  await evaluate(`document.querySelector('.rail [data-id="payments"] .name').click()`);
  await browser("wait", ".pane-screen");
  expect(await read()).toBe("payments");
}, 180_000);

it("u507_layout_checks", async () => {
  const captures = captureDir("U495") ?? captureDir("U507");
  const baseline = new Map<string, Record<string, { status: string }>>();

  for (const side of main ? ["base", "head"] : ["head"]) {
    const origin = (side === "base" ? main! : server).resolvedUrls!.local[0];

    for (const width of [FULLSCREEN.width]) {
      await browser("set", "viewport", String(width), "800");
      const url = `${origin}harness.html?seed=tree-40${side === "head" && !captureDir("U495") ? "&bound=1" : ""}`;
      await browser("open", url);
      await browser("wait", "--fn", "Boolean(window.__fake) && Boolean(document.querySelector('[data-layout-root]'))");
      await evaluate("localStorage.clear()");
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await settle();
      await evaluate("window.__fake.app.exitDaemon({code:1})");
      await settle();

      for (const open of [true, false]) {
        if (!open) {
          await evaluate(`document.querySelector('[aria-label="Hide work items"]').click()`);
          await settle();
        }

        const name = `${width}x800-${open ? "open" : "closed"}-failure`;
        const checks = await evaluate<Record<string, { status: string }>>("window.__checks()");

        if (side === "base") baseline.set(name, checks);
        else for (const [id, check] of Object.entries(checks)) {
          if (["D2", "D5", "D6"].includes(id) || baseline.get(name)?.[id]?.status === "pass") expect(check.status, `${name} ${id}: ${JSON.stringify(check)}`).toBe("pass");
        }

        if (captures) {
          mkdirSync(join(captures, side), { recursive: true });
          writeFileSync(join(captures, side, `${name}.checks.json`), JSON.stringify(checks));
          await browser("screenshot", join(captures, side, `${name}.png`));
        }
      }
    }
  }
}, 180_000);

it("u495_selected_project_tab_labels_the_real_layout_regions", async () => {
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tabs-8&tabs=1`);
  await browser("wait", "--fn", "document.querySelectorAll('.header [role=tab][aria-busy=false]').length === 8");
  await evaluate(`document.querySelector('[data-path="/Users/you/project-number-2"] [role=tab]').click()`);
  await browser("wait", "--fn", "Boolean(document.querySelector('.rail [data-id=p2-agent]'))");
  await settle();

  const linked = () => evaluate(`(() => {
    const tab = document.querySelector('.header [role=tab][aria-selected=true]');
    const controls = tab?.getAttribute('aria-controls')?.trim().split(/\\s+/) ?? [];
    const panel = controls.length === 1 ? document.getElementById(controls[0]) : null;
    const labels = panel?.getAttribute('aria-labelledby')?.trim().split(/\\s+/) ?? [];
    return Boolean(panel?.isConnected && panel.getAttribute('role') === 'tabpanel'
      && labels.length === 1 && labels[0] === tab.id
      && ['rail','centre','shelf'].every(part => panel.contains(document.querySelector('[data-layout-panel='+part+']')))
      && !panel.contains(tab) && !panel.hidden);
  })()`);

  expect(await linked()).toBe(true);
  await browser("click", '.header [role=tab][aria-selected=true]');
  await browser("press", "ArrowRight");
  await browser("wait", "--fn", "document.activeElement?.getAttribute('data-value') !== document.querySelector('.header [role=tab][aria-selected=true]')?.getAttribute('data-value')");
  expect(await evaluate(`document.querySelector('.header [role=tab][aria-selected=true]').getAttribute('data-value')`)).toBe("/Users/you/project-number-2");
  await browser("press", "Enter");
  await browser("wait", "--fn", "document.activeElement === document.querySelector('.header [role=tab][aria-selected=true]') && Boolean(document.querySelector('.rail [data-id=p3-agent]'))");
  expect(await linked()).toBe(true);
  await evaluate("window.__fake.app.chooser.path = '/Users/you/Project 雪 space'");
  await browser("click", ".strip-add");
  await browser("wait", "--fn", "document.querySelector('.header [role=tab][aria-selected=true]')?.getAttribute('data-value') === '/Users/you/Project 雪 space' && document.querySelector('.header [role=tab][aria-selected=true]')?.getAttribute('aria-busy') === 'false'");
  expect(await linked()).toBe(true);
}, 90_000);

it("u495_composed_header_preserves_project_actions", async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tabs-8&tabs=1`);
  await browser("wait", "--fn", "document.querySelectorAll('.header [role=tab][aria-busy=false]').length === 8");
  await settle();
  // A background Daemon still updates its mark under the common Tabs root.
  await evaluate(`window.__fake.app.of('/Users/you/project-number-3').emit({actor:{kind:'user',id:'you',parent:null},name:'agent.status',data:{id:'p3-agent',attempt:'1',status_revision:'9999',status:{kind:'error',label:'Background failure 雪',since:Date.now()}}})`);
  await browser("wait", "--fn", "Boolean(document.querySelector('[data-path=\"/Users/you/project-number-3\"] .tab-mark[data-kind=error]'))");
  await evaluate(`document.querySelector('[data-path="/Users/you/project-number-3"] .tab-mark').click()`);
  await browser("wait", "--fn", "document.querySelector('.rail [aria-selected=true]')?.dataset.id === 'p3-agent'");
  expect(await evaluate(`document.querySelector('.header [role=tab][aria-selected=true]').getAttribute('data-value')`)).toBe("/Users/you/project-number-3");

  await browser("dblclick", '[data-path="/Users/you/project-number-3"] .tab-name');
  await browser("wait", ".tab-rename");
  await browser("fill", ".tab-rename", "Authored 雪 name");
  await browser("press", "Enter");
  await browser("wait", "--fn", "document.querySelector('.window-title')?.textContent === 'Authored 雪 name'");
  expect(await evaluate(`window.__fake.app.windowOperations.at(-1)`)).toEqual({kind:"title",title:"Authored 雪 name"});

  // Reach and select the overflowing error Project using the real Strip edge.
  await browser("wait", "--fn", "Boolean(document.querySelector('.strip-edge-right'))");
  await browser("click", ".strip-edge-right");
  await settle();
  await browser("click", '[data-path="/Users/you/project-number-8"] [role=tab]');
  await browser("wait", "--fn", "Boolean(document.querySelector('.rail [data-id=p8-agent]'))");
  await evaluate(`document.querySelector('[data-path="/Users/you/project-number-3"] [role=tab]').click()`);
  await browser("wait", "--fn", "document.querySelector('.rail [aria-selected=true]')?.dataset.id === 'p3-agent'");

  // Close a visible sibling through the real confirmation and App close call.
  await evaluate(`document.querySelector('[data-path="/Users/you/project-number-4"] [role=tab]').focus()`);
  await browser("click", '[data-path="/Users/you/project-number-4"] .tab-close');
  await browser("wait", "[role=alertdialog]");
  await browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");
  await browser("wait", "--fn", "document.querySelectorAll('.header [role=tab]').length === 7");
  expect(await evaluate("window.__fake.app.closed")).toEqual(["/Users/you/project-number-4"]);
  expect(await evaluate("document.querySelector('.header button button')")).toBeNull();
}, 90_000);
