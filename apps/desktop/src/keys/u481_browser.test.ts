import type { mountRegistryLayers } from "./keysFixture";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { FULLSCREEN } from "../testing/chromePage";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u481-"));

const art = captureDir("U481");

const layerArt = captureDir("U496");

const session = `u481-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();

  if (art) mkdirSync(art, { recursive: true });

  if (layerArt) mkdirSync(layerArt, { recursive: true });
  origin = server.resolvedUrls.local[0]!;
  const ready = await fetch(new URL("/__roundup_ready", origin));

  if (!ready.ok) throw new Error(await ready.text());
  await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", origin).href);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const wait = async (expression: string) => browser("wait", "--fn", expression);

const load = async () => {
  await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await browser("click", ".rail-row");
  await wait(`!!document.querySelector('.pane-screen')`);
};

const prepare = async () => {
  await read(`(() => {
    window.__origin = document.querySelector('.rail-row[data-selected=true]');
    window.__origin.focus();
    window.__selected = document.querySelector('.rail-row[data-selected=true]')?.dataset.id;
    window.__calls = window.__fake.app.calls.length;
    window.__escape = 0;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') window.__escape++; });
  })()`);
};

const open = async () => {
  await browser("press", "Shift+?");
  await wait(`!!document.querySelector('.help') && document.querySelector('.help').contains(document.activeElement)`);
};

const closed = async () => wait(`!document.querySelector('.help') && document.activeElement === window.__origin`);

it("u481_help_escape_restores_focus_without_underlying_action", async () => {
  await load();
  await browser("click", ".terminal-new");
  await wait(`!!document.querySelector(".bubble .xterm-screen")`);
  await prepare(); await open();
  await browser("press", "Meta+k");
  await browser("press", "Meta+n");
  await browser("press", "Escape"); await closed();
  expect(await read(`({selected: document.querySelector('.rail-row[data-selected=true]')?.dataset.id === window.__selected,
    calls: window.__fake.app.calls.slice(window.__calls).map(c => c.method).filter(method => method !== "project.resources"), escape: window.__escape,
    models: !!document.querySelector('.models-sheet')})`)).toEqual({selected: true, calls: [], escape: 0, models: false});
}, 60_000);

it("u481_help_dialog_traps_and_returns_focus", async () => {
  await load(); await prepare();

  for (const dismissal of ["question", "outside"]) {
    await open();

    for (const key of ["Tab", "Shift+Tab"]) {
      await browser("press", key);
      expect(await read(`document.querySelector('.help').contains(document.activeElement)`)).toBe(true);
    }

    if (dismissal === "question") await browser("press", "Shift+?");
    else {
      await browser("mouse", "move", "10", "400");
      await browser("mouse", "down"); await browser("mouse", "up");
    }

    await closed();
  }
}, 60_000);

it("u481_help_close_after_origin_removal_is_safe", async () => {
  await load(); await prepare(); await open();
  await read(`window.__origin.remove()`);
  await browser("press", "Escape");
  await wait(`!document.querySelector('.help')`);
  expect(await read(`document.activeElement.isConnected && document.activeElement !== window.__origin`)).toBe(true);
}, 60_000);

it("u481_help_preserves_rendered_checks_and_failure", async () => {
  for (const more of [false, true]) {
    if (more) {
      await browser("close");
      await browser("--profile", profile, "--args", "--force-high-contrast,--disable-blink-features=ForcedColors", "open", origin);
    }

    for (const width of [FULLSCREEN.width]) for (const scheme of ["light", "dark"]) {
      await browser("set", "viewport", String(width), "800");
      await browser("set", "media", scheme);
      await load();
      await read(`(() => {
        window.__fake.failNext(-32003, 'Keyboard observer rejected send: complete failure remains visible');
        document.querySelector('[aria-label="Add Workstream"]').click();
      })()`);
      await wait(`document.querySelector('p.ink[role=alert]')?.textContent.includes('Keyboard observer rejected send: complete failure remains visible')`);
      expect(await read(`matchMedia("(prefers-contrast: more)").matches`)).toBe(more);
      expect(await read(`matchMedia("(forced-colors: active)").matches`)).toBe(false);
      const before = await read<Checks>(`window.__checks()`);
      await prepare(); await open();
      const during = await read<Checks>(`window.__checks()`);

      if (art) await browser("screenshot", join(art, `${width}-${scheme}-${more}-help.png`));

      if (art) writeFileSync(join(art, `${width}-${scheme}-${more}-help.checks.json`), JSON.stringify(during));

      for (const id of CHECK_IDS) if (before[id].status === "pass") expect(during[id].status, `${width} ${scheme} open ${id}`).toBe("pass");

      for (const id of ["D2", "D5", "D6"] as const) expect(during[id].status, `${width} ${scheme} ${id}`).toBe("pass");
      expect(await read(`(() => {
        const help = document.querySelector('.help'), box = help.getBoundingClientRect(), rail = document.querySelector('.rail').getBoundingClientRect();
        return box.left >= rail.right && box.right <= innerWidth && box.bottom <= innerHeight && help.scrollWidth <= help.clientWidth && help.scrollHeight <= help.clientHeight;
      })()`)).toBe(true);
      await browser("press", "Escape"); await closed();
      const after = await read<Checks>(`window.__checks()`);

      if (art) await browser("screenshot", join(art, `${width}-${scheme}-${more}-failure.png`));

      if (art) writeFileSync(join(art, `${width}-${scheme}-${more}-failure.checks.json`), JSON.stringify(after));

      for (const id of CHECK_IDS) if (before[id].status === "pass") expect(after[id].status, `${width} ${scheme} ${id}`).toBe("pass");
      expect(await read(`(() => {
        const error = document.querySelector('p.ink[role=alert]'), box = error.getBoundingClientRect();
        return error.textContent.includes('Keyboard observer rejected send: complete failure remains visible') && box.height > 0 && box.bottom <= innerHeight && error.scrollWidth <= error.clientWidth;
      })()`)).toBe(true);
    }
  }
}, 180_000);


const mountLayers = (...args: Parameters<typeof mountRegistryLayers>) => read(`(async () => {
  const fixture = await import('/src/keys/keysFixture.tsx');
  window.__registryFixture = fixture.mountRegistryLayers(...${JSON.stringify(args)});
  window.__terminalCalls = window.__fake.app.calls.filter(c => c.method === 'terminal.write').length;
})()`);

it("u496_top_layer_escape_is_order_independent", async () => {
  for (const reverse of [false, true]) for (const nested of [false, true]) for (const top of ["modal", "menu"]) {
    await browser("set", "viewport", reverse ? "1440" : "1280", "800");
    await load();
    await browser("click", ".terminal-new");
    await wait(`!!document.querySelector(".bubble .xterm-screen")`);
    await mountLayers(reverse, nested);
    await browser("click", top === "modal" ? '[data-registry-modal-trigger]' : '[data-registry-menu-trigger]');
    const selector = top === "modal" ? '[role=dialog]' : '[role=menu]';
    await wait(`document.querySelector('${selector}')?.contains(document.activeElement)`);

    const depths = await read<{drawer: number; top: number}>(`(() => {
      const depth = node => { let count = 0; for (; node; node = node.parentElement) count++; return count; };
      const drawer = depth(document.querySelector('[data-registry-drawer]'));
      const top = depth(document.querySelector('${selector}'));
      return {drawer, top};
    })()`);

    expect(nested ? depths.drawer > depths.top : depths.drawer === depths.top, JSON.stringify(depths)).toBe(true);

    if (layerArt) {
      await browser("screenshot", join(layerArt, `${reverse}-${nested}-${top}-open.png`));
      writeFileSync(join(layerArt, `${reverse}-${nested}-${top}-open.checks.json`), JSON.stringify(await read<Checks>(`window.__checks()`)));
    }

    await read(`window.__drawerContent = document.querySelector('[data-registry-drawer]').textContent`);
    await browser("press", "Escape");
    await wait(`!document.querySelector('${selector}')`);
    await wait(`document.activeElement === document.querySelector(${JSON.stringify(top === "modal" ? '[data-registry-modal-trigger]' : '[data-registry-menu-trigger]')})`);
    expect(await read(`document.querySelector('[data-registry-drawer]').textContent === window.__drawerContent`)).toBe(true);
    await read(`document.querySelector('[data-registry-drawer]').focus()`);
    await browser("press", "Escape");
    await wait(`!document.querySelector('[data-registry-drawer]')`);
    expect(await read(`({focus: document.activeElement === document.querySelector('[data-registry-origin]'),
      writes: window.__fake.app.calls.filter(c => c.method === 'terminal.write').length - window.__terminalCalls})`)).toEqual({focus: true, writes: 0});
    await read(`window.__registryFixture.unmount()`);
  }
}, 180_000);

it("u496_editor_and_terminal_keep_escape", async () => {
  await load();
  await mountLayers(false, true, true);

  for (const selector of ["input", "textarea", "[contenteditable]", ".xterm"]) {
    await read(`document.querySelector('[data-registry-drawer] ${selector}').focus()`);
    await browser("press", "Escape");
    expect(await read(`!!document.querySelector('[data-registry-drawer]')`)).toBe(true);
  }

  await read(`document.querySelector('[data-registry-origin]').focus()`);
  await browser("press", "Escape");
  await wait(`!document.querySelector('[data-registry-drawer]')`);
  expect(await read(`document.activeElement === document.querySelector('[data-registry-origin]')`)).toBe(true);
  await read(`window.__registryFixture.unmount()`);
}, 60_000);
