import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { promisify } from "node:util";
import { createServer } from "vite";
import { chromePath } from "../testing/chromePage";
import { describe, expect, it } from "vitest";
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

it("u491_layout_host_measures_owned_panels_without_changing_grid_or_shelf_placement", async () => {
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
    const widths = createWidths(() => '/u491-host');
    const api = useSplitter(() => ({
      id: 'u491',
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

  const server = await createServer({
    cacheDir: "node_modules/.vite-u491-layout",
    server: { port: 0, strictPort: false },
    plugins: [{
      name: "u491-layout-host",
      resolveId: (id) => id === "/u491-host.js" ? id : undefined,
      load: (id) => id === "/u491-host.js" ? fixture : undefined,
    }],
  });

  const captures = captureDir("U491");

  if (captures) mkdirSync(captures, { recursive: true });

  const session = `u491-layout-${process.pid}`;
  const env = { ...process.env };
  const executable = chromePath();

  if (executable) env.AGENT_BROWSER_EXECUTABLE_PATH = executable;

  const browser = (...args: string[]) => promisify(execFile)("agent-browser", ["--session", session, ...args], {
    encoding: "utf8", timeout: 60_000,
    env,
  }).then((result) => result.stdout);

  try {
    await server.listen();
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

    await browser("eval", "(async () => { await document.fonts.ready; (await import('/u491-host.js')).mount(); })()");

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
  } finally {
    try { await browser("close"); } finally { await server.close(); }
  }
}, 180_000);
