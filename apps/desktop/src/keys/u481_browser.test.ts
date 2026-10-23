import { captureDir } from "../testing/captures";
import type { mountRegistryLayers } from "./keysFixture";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u481-"));

const session = `u481-${process.pid}`;

const profileMore = mkdtempSync(join(tmpdir(), "u3513-more-"));

let increased = false;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", `${session}${increased ? "-more" : ""}`, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();

  origin = server.resolvedUrls.local[0]!;
  const ready = await fetch(new URL("/__roundup_ready", origin));

  if (!ready.ok) throw new Error(await ready.text());
  await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", origin).href);

  if (captureDir("U3513e")) {
    increased = true;
    await browser("--profile", profileMore, "--args", "--force-high-contrast,--disable-features=ForcedColors", "open", new URL("/harness.html?seed=tree-40", origin).href);
    increased = false;
  }
}, 90_000);

afterAll(async () => {
  try {
    await browser("close");

    if (captureDir("U3513e")) { increased = true; await browser("close"); increased = false; }
  } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); rmSync(profileMore, { recursive: true, force: true }); }
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
    calls: window.__fake.app.calls.slice(window.__calls).map(c => c.method).filter(method => method !== "project.resources"), escape: window.__escape})`)).toEqual({selected: true, calls: [], escape: 0});
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

const hintContexts = ["rail", "agent", "taken-agent", "terminal-tab", "bubble", "todos", "pads", "shelf", "narrow-shelf", "maximised-shelf", "overlay-shelf", "triage", "pad", "drawer", "switcher", "empty"];

const capture = async (id: string, name: string) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${name}${increased ? "-contrast" : ""}.png`));
  writeFileSync(join(dir, `${name}${increased ? "-contrast" : ""}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
};

const focusContext = async (name: string) => {
  await browser("open", new URL(`/harness.html?seed=${name === "empty" ? "empty-project" : "tree-40"}`, origin).href);
  await wait("!!window.__fake && !!document.querySelector('[role=tree]')");
  await capture("U3513a", `${name}-before`);

  if (name === "empty") {
    await browser("focus", ".pane-action");
  } else if (["todos", "pads", "shelf", "narrow-shelf", "maximised-shelf", "overlay-shelf", "triage", "pad", "drawer"].includes(name)) {
    await read(`document.querySelector('[data-todo-root]').click()`);
    await read(`(() => {
      const tab = [...document.querySelectorAll('.header [role=tab]')].find(e => e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(name === "pads" || name === "pad" ? "pads" : "todos")}));
      if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    })()`);
    await wait("!!document.querySelector('.shelf [data-shelf-group]')");
    await read(`document.querySelectorAll('.shelf [data-part=branch-control]').forEach(e => { if(e.closest('[role=treeitem]')?.getAttribute('aria-expanded') === 'false') e.click(); })`);

    if (name.endsWith("shelf")) {
      if (name === "maximised-shelf") await browser("click", '.shelf [aria-label=Maximise]');

      if (name === "narrow-shelf") await read(`document.querySelector('.window').style.setProperty('--shelf-span', '240px')`);

      if (name === "overlay-shelf") await read(`document.querySelector('.window').style.setProperty('--centre-min-width', '960px')`);
      await browser("focus", '.shelf [aria-label="Close work items"]');
    } else if (name === "triage") {
      await browser("click", '[data-triage-toggle]');
    } else {
      const row = name === "pads" || name === "pad" ? ".shelf .pad-name" : ".shelf .todo-row-button[aria-pressed]";
      await browser("focus", row + ":first-of-type");

      if (name === "pad" || name === "drawer") {
        await read(`document.querySelector(${JSON.stringify(row)}).click()`);
        await wait(`!!document.querySelector(${JSON.stringify(name === "pad" ? ".pad-body button" : ".drawer .close")})`);

        if (name === "drawer") await browser("fill", ".todo-comment-field", "unfinished ? comment");
        await browser("focus", name === "pad" ? ".pad-body button" : ".drawer .close");
      }
    }
  } else {
    await browser("click", '.rail-row[data-id="agent-4"]');
    await wait("!!document.querySelector('.pane-control button')");

    if (name === "rail") await browser("focus", '.rail-row[data-id="agent-4"]');
    else if (name === "agent" || name === "taken-agent") {
      if (name === "taken-agent") await browser("click", ".pane-control button");
      await browser("focus", ".pane-control button");
    } else if (name === "switcher") {
      await browser("focus", '.rail-row[data-id="agent-4"]');
      await read(`(() => {
        const from = document.activeElement;
        from.dispatchEvent(new KeyboardEvent('keydown', {key:'k',code:'KeyK',metaKey:true,bubbles:true,cancelable:true}));
        from.dispatchEvent(new KeyboardEvent('keydown', {key:'k',code:'KeyK',bubbles:true,cancelable:true}));
      })()`);
      await wait("!!document.querySelector('.switcher input')");
      await browser("fill", ".switcher input", "agent");
      await browser("focus", ".switcher");
    } else {
      await browser("click", ".terminal-new");
      await wait("!!document.querySelector('.bubble .xterm-screen')");
      await browser("focus", name === "bubble" ? ".bubble button" : ".terminal-tab");
    }
  }

  await wait("!!document.querySelector('.hint-line')");
};

it.each(hintContexts)("u3513b_help_returns_to_its_origin_without_an_underlying_action: %s", async name => {
  for (const contrast of captureDir("U3513e") ? [false, true] : [false]) {
    increased = contrast;
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await read("localStorage.clear()");
    await focusContext(name);
    await capture("U3513e", `${name}-line`);
    await capture("U3513d", `${name}-line`);
    await read(`(() => {
      window.__origin = document.activeElement;
      window.__selected = document.querySelector('.rail-row[data-selected=true]')?.dataset.id;
      window.__query = document.querySelector('.switcher input')?.value;
      window.__drafts = [...document.querySelectorAll('.drawer input,.drawer textarea,.switcher input')].map(field => [field, field.value]);
      window.__triage = document.querySelector('[data-triage-toggle]')?.getAttribute('aria-pressed');
      window.__panels = [...document.querySelectorAll('.bubble')].map(panel => [panel.dataset.bubble, panel.hidden]);
      window.__calls = window.__fake.app.calls.length;
    })()`);

    for (const dismissal of ["Escape", "question", "outside"]) {
      await open();
      await capture("U3513b", `${name}-${dismissal}-help`);

      if (dismissal === "outside") {
        await browser("mouse", "move", "10", "400");
        await browser("mouse", "down");
        await browser("mouse", "up");
      } else if (dismissal === "question") await browser("press", "Shift+?");
      else await browser("press", "Escape");

      await closed();
      expect(await read(`({selection:document.querySelector('.rail-row[data-selected=true]')?.dataset.id === window.__selected,
        query:document.querySelector('.switcher input')?.value === window.__query,
        drafts:window.__drafts.every(([field,value]) => field.isConnected && field.value === value),
        triage:document.querySelector('[data-triage-toggle]')?.getAttribute('aria-pressed') === window.__triage,
        panels:JSON.stringify([...document.querySelectorAll('.bubble')].map(panel => [panel.dataset.bubble,panel.hidden])) === JSON.stringify(window.__panels),
        mutations:window.__fake.app.calls.slice(window.__calls).filter(c => !['project.resources','rail.tree','terminal.list','terminal.resize','terminal.snapshot'].includes(c.method))})`)).toEqual({selection:true,query:true,drafts:true,triage:true,panels:true,mutations:[]});
    }

    await capture("U3513b", `${name}-after`);
  }

  increased = false;
}, 60_000);

it("u3513c_editable_and_modal_owners_keep_question_mark", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await focusContext("switcher");
  await browser("fill", ".switcher input", "draft");
  await browser("press", "Shift+?");
  expect(await read("document.querySelector('.switcher input').value")).toBe("draft?");
  expect(await read("!!document.querySelector('.help')")).toBe(false);
  await capture("U3513c", "switcher-input");

  await focusContext("drawer");
  await browser("fill", ".todo-comment-field", "draft");
  await browser("press", "Shift+?");
  expect(await read("document.querySelector('.todo-comment-field').value")).toBe("draft?");
  expect(await read("!!document.querySelector('.help')")).toBe(false);
  await capture("U3513c", "comment-input");

  await focusContext("pad");
  await wait("!!document.querySelector('.ProseMirror[contenteditable=true]')");
  await browser("focus", ".ProseMirror");
  await browser("press", "Shift+?");
  expect(await read("document.querySelector('.ProseMirror').textContent.includes('?')")).toBe(true);
  expect(await read("!!document.querySelector('.help')")).toBe(false);
  await capture("U3513c", "pad-editor");

  await focusContext("agent");
  await browser("focus", ".pane-screen textarea");
  await browser("press", "Shift+?");
  expect(await read("!!document.querySelector('.help')")).toBe(false);
  await capture("U3513c", "terminal-input");
}, 60_000);

it("u3513a_rejected_todo_mutation_keeps_its_cause_actionable", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await focusContext("triage");
  await read(`window.__fake.failNext(-32000, 'disk full')`);
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'x',code:'KeyX',bubbles:true,cancelable:true}))`);
  await wait(`document.querySelector('.shelf')?.textContent.includes('disk full')`);
  await capture("U3513a", "triage-refused");
  await read(`window.__origin = document.activeElement`);
  await open();
  await browser("press", "Escape");
  await closed();
  expect(await read(`document.querySelector('.shelf').textContent.includes('disk full')`)).toBe(true);
  await capture("U3513b", "triage-refused-after-help");
}, 60_000);
