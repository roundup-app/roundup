import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { promisify } from "node:util";
import { createServer } from "vite";
import { chromePath } from "../testing/chromePage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import styles from "../styles.css?inline";

const effective = (css: string, selector: string, property: string) =>
  [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${selector}\\s*{([^}]*)}`, "g"))]
    .flatMap(([, body]) => [...(body ?? "").matchAll(new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g"))].map((m) => m[1]))
    .at(-1);

// U389 narrows U23 and U24: the Rail's width is the user's Token (252 to 480 px, 288 by default) and the centre keeps 388 px, at every window width.
describe("u23 column widths", () => {
  it("u23_the_rail_is_the_token_and_the_centre_keeps_a_floor_of_388px", () => {
    expect(effective(styles, "\\.window", "--rail-width")).toBeUndefined();
    expect(effective(styles, "\\.columns", "grid-template-columns")).toBe("var(--rail-width) minmax(var(--centre-min-width), 1fr)");
  });
});

describe("u24 narrow window", () => {
  it("u24_no_width_changes_the_columns", () => {
    expect(styles).not.toContain("@media (max-width");
  });

  it("u24_the_full_height_shelf_sits_outside_the_columns", () => {
    expect(effective(styles, "\\.shelf", "position")).toBe("absolute");
    expect(effective(styles, "\\.shelf", "grid-area")).toBeUndefined();
    expect(effective(styles, "\\.rail", "grid-area")).toBeUndefined();
    expect(effective(styles, "\\.centre", "grid-area")).toBeUndefined();
  });

  it("u24_the_drawer_leaves_the_rail_visible", () => {
    expect(effective(styles, "\\.window", "--drawer-span")).toBe("max(560px, calc(var(--shelf-span) + var(--space-5)))");
    expect(effective(styles, "\\.drawer", "width")).toBe("var(--drawer-span)");
  });
});

// The real Layout plus installed Ark, served by Vite in an isolated headless session.

const fixture = `
import { createComponent, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { useSplitter } from '@ark-ui/solid/splitter';
import { Layout } from '/src/app/Layout.tsx';
import { createWidths } from '/src/resize/widths.ts';

export const mount = () => {
  const host = document.createElement('div');
  host.style.height = '100%';
  document.body.replaceChildren(host);
  render(() => {
    const [open, setOpen] = createSignal(true);
    const widths = createWidths(() => '/u507-host');
    const api = useSplitter(() => ({
      id: 'u507',
      panels: [{ id: 'rail', minSize: '252px', maxSize: '480px' }, { id: 'centre' }, { id: 'shelf' }],
      defaultSize: [22.5, 52.5, 25],
    }));
    window.__host = { api, widths, setOpen };
    return createComponent(Layout, {
      header: 'Header', rail: 'Rail', centre: 'Centre', shelf: 'Shelf', overlay: null, widths,
      get shelfPlacement() {
        return { open: open(), rendered: open(), shown: open(), animated: false, onSettle() {} };
      },
      get splitter() {
        return {
          root: api().getRootProps(),
          rail: api().getPanelProps({ id: 'rail' }),
          centre: api().getPanelProps({ id: 'centre' }),
          shelf: api().getPanelProps({ id: 'shelf' }),
        };
      },
    });
  }, host);
};
`;

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
          .replace('import { copy }', 'import { Tabs } from "../ui";\nconst TabList = (props: Parameters<typeof Tabs.List>[0]) => new URL(location.href).searchParams.has("tabs") ? <Tabs.List {...props} /> : <div {...props} />;\nimport { copy }')
          .replace('<div class="tablist"', '<TabList class="tablist"')
          .replace('        </div>\n        {edge(copy.right', '        </TabList>\n        {edge(copy.right');

        if (id.endsWith("/header/ProjectTab.tsx") && !source.includes("<Tabs.Trigger")) return source
          .replace('import { copy }', 'import { Tabs } from "../ui";\nconst ProjectTrigger = (props: Parameters<typeof Tabs.Trigger>[0]) => new URL(location.href).searchParams.has("tabs") ? <Tabs.Trigger {...props} /> : <button {...props} />;\nimport { copy }')
          .replace('<button data-button="quiet"\n          type="button"\n          role="tab"', '<ProjectTrigger value={props.tab.path} data-button="quiet"\n          type="button"\n          role="tab"')
          .replace('        </button>\n        <button data-button="icon"', '        </ProjectTrigger>\n        <button data-button="icon"');
      } },
      resolveId: (id, importer) => id === "./app/Layout" && importer?.endsWith("/src/App.tsx") ? "/u507-bound-layout.js" : id === "/u507-host.js" ? id : undefined,
      load: (id) => id === "/u507-host.js" ? fixture : id === "/u507-bound-layout.js" ? `
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

it("u507_layout_host_measures_owned_panels_without_changing_grid_or_shelf_placement", async () => {
  const captures = captureDir("U507");

  if (captures) mkdirSync(captures, { recursive: true });
    await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tree-40`);
    await browser("set", "viewport", "1280", "800");
    await browser("wait", "--fn", "Boolean(window.__fake) && document.querySelectorAll('[role=separator]').length === 2");

    const defaultHost = JSON.parse(await browser("--json", "eval", `(() => {
      const root = document.querySelector('[data-layout-root]');
      if (!root) return null;
      return {
        width: root.getBoundingClientRect().width,
        panels: [...root.querySelectorAll('[data-layout-panel]')].map(el => el.dataset.layoutPanel),
        edges: [...root.querySelectorAll('[role=separator]')].filter(el => el.closest('[data-layout-root]') === root).length,
      };
    })()`));

    expect(defaultHost.data.result).toEqual({ width: 1280, panels: ["rail", "centre", "shelf"], edges: 2 });

    await browser("eval", "(async () => { await document.fonts.ready; (await import('/u507-host.js')).mount(); })()");

    for (const width of [1280, 1440]) {
      await browser("set", "viewport", String(width), "800");

      for (const open of [true, false]) {
        await browser("eval", `window.__host.setOpen(${open})`);
        await browser("wait", "--fn", `document.querySelector('[data-id="shelf"]').hidden === ${!open}`);

        const output = JSON.parse(await browser("--json", "eval", `(() => {
          const root = document.querySelector('[data-part="root"]');
          const panels = [...root.querySelectorAll('[data-part="panel"][data-ownedby="' + root.id + '"]')];
          return { width: root.getBoundingClientRect().width, display: getComputedStyle(root).display,
            columns: getComputedStyle(panels[0].parentElement).display,
            panels: panels.map(el => ({ id: el.dataset.id, width: el.getBoundingClientRect().width, hidden: el.hidden })) };
        })()`));

        expect(output.success).toBe(true);
        expect(output.data.result).toEqual({ width, display: "grid", columns: "grid", panels: [
          { id: "rail", width: 288, hidden: false },
          { id: "centre", width: width - 288 - (open ? 320 : 0), hidden: false },
          { id: "shelf", width: open ? 320 : 0, hidden: !open },
        ] });

        if (captures) {
          const name = `host-${width}x800-${open ? "open" : "closed"}`;

          writeFileSync(join(captures, `${name}.json`), JSON.stringify(output.data.result));
          await browser("screenshot", join(captures, `${name}.png`));
        }
      }
    }

    await browser("eval", "window.__host.setOpen(true); window.__host.widths.rail.commit(480); window.__host.widths.shelf.commit(560)");
    await browser("set", "viewport", "1280", "800");
    await browser("wait", "--fn", "document.querySelector('[data-part=root]').dataset.shelfMode === 'overlay'");

    const overlay = JSON.parse(await browser("--json", "eval", `(() => ({
      root: document.querySelector('[data-part=root]').getBoundingClientRect().width,
      centre: document.querySelector('[data-id=centre]').getBoundingClientRect().width,
      shelf: document.querySelector('[data-id=shelf]').getBoundingClientRect().width,
    }))()`));

    expect(overlay.data.result).toEqual({ root: 1280, centre: 800, shelf: 560 });
}, 180_000);

const openApp = async (bound = true) => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tree-40${bound ? "&bound=1" : ""}`);
  await browser("wait", "--fn", "Boolean(window.__fake) && document.querySelectorAll('[role=separator]').length === 2");
  await settle();
  expect(await evaluate(`document.querySelector('[data-layout-root]').dataset.scope === 'splitter'`)).toBe(bound);

  if (bound) expect(await evaluate(`document.querySelectorAll('[data-part=panel][data-ownedby]').length`)).toBe(3);
};

// The unbound Layout is retired: the shared Splitter binds every Layout (U502), and `u502_browser` proves the same keys, drag and reset.
for (const bound of [true]) it(`u507_bindings_preserve_width_controls_${bound}`, async () => {
  await openApp(bound);
  await evaluate("localStorage.clear()");
  await openApp(bound);

  for (const [panel, start, preview, committed] of [["rail", 288, 360, 304], ["shelf", 960, 880, 336]] as const) {
    const read = () => evaluate<number>(`document.querySelector('[data-layout-panel=${panel}]').getBoundingClientRect().width`);
    await browser("mouse", "move", String(start), "400");
    await browser("mouse", "down", "left");
    await browser("mouse", "move", String(preview), "400");
    await settle();
    expect(await read()).toBe(panel === "rail" ? 360 : 400);
    expect(await evaluate(`localStorage.getItem('roundup:widths:/Users/you/harness')`)).toBe(panel === "rail" ? null : JSON.stringify({ rail: 304, shelf: 320 }));
    await browser("press", "Escape");
    await browser("mouse", "up", "left");
    await settle();
    expect(await read()).toBe(panel === "rail" ? 288 : 320);
    await evaluate(`(() => { const edge = document.querySelector('[aria-label="${panel === "rail" ? "Resize Rail" : "Resize work items"}"]'); edge.focus(); edge.dispatchEvent(new KeyboardEvent('keydown', {key:'${panel === "rail" ? "ArrowRight" : "ArrowLeft"}', bubbles:true})); })()`);
    await settle();
    expect(await read()).toBe(committed);
  }

  await openApp(bound);
  expect(await evaluate(`['rail','centre','shelf'].map(id => document.querySelector('[data-layout-panel='+id+']').getBoundingClientRect().width)`)).toEqual([304, 640, 336]);
  expect(await evaluate(`document.querySelector('[data-layout-root]').style.cssText`)).toContain("--rail-width: 304px");
  expect(await evaluate(`document.querySelector('[data-layout-root]').style.cssText`)).toContain("--shelf-span: 336px");
}, 120_000);

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

    for (const width of [1280, 1440]) {
      await browser("set", "viewport", String(width), "800");
      const url = `${origin}harness.html?seed=tree-40${side === "head" && !captureDir("U495") ? "&bound=1" : ""}`;
      await browser("open", url);
      await browser("wait", "--fn", "Boolean(window.__fake) && Boolean(document.querySelector('[data-layout-root]'))");
      await evaluate("localStorage.clear()");
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await settle();
      // The Rail keeps the Daemon failure visible even with the Shelf closed.
      await evaluate("window.__fake.app.exitDaemon({code:1})");
      await settle();
      expect(await evaluate(`(() => {
        const error = [...document.querySelectorAll('[role=alert]')].find(el => el.textContent.includes('Daemon exited 1'));
        const box = error?.getBoundingClientRect();
        return Boolean(box && box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight);
      })()`)).toBe(true);

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
