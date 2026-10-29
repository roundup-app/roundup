import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer, type ViteDevServer } from "vite";
import { realDaemon, } from "../testing/realDaemonPlugin";
import { expect, it } from "vitest";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

it("u2773a_ask_restores_exact_work_after_real_project_reload_and_reopen", async () => {
  const real = await startRealDaemon({}, true);
  const profile = mkdtempSync(join(tmpdir(), "unfinished-ask-profile-"));
  const session = `unfinished-ask-${process.pid}`;
  writeFileSync(join(profile, "config.json"), "{}");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", join(profile, "config.json"), "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000 })).stdout;
  const app = createServedApp(real.base);
  const exact = "@Captured  e\u0301 🌿\nlast line  ";

  try {
    const original = await app.rpc("rail.createWorkstream", { name: "Captured", parent: null });
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&view=made&view=ask-history&daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("wait", ".ask-input");
    await browser("eval", `(() => {
      const field = document.querySelector('.ask-input');
      field.focus(); field.value = ${JSON.stringify(exact)};
      field.dispatchEvent(new Event('input', {bubbles: true}));
      field.setSelectionRange(2, 6, 'backward');
      field.dispatchEvent(new Event('select', {bubbles: true}));
    })()`);
    await app.rpc("rail.rename", { id: original.id, name: "Renamed" });
    const replacement = await app.rpc("rail.createWorkstream", { name: "Captured", parent: null });
    await browser("reload");
    await browser("wait", ".ask-input");

    const restored = JSON.parse(await browser("eval", `(() => {
      const field = document.querySelector('.ask-input');
      return [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection, document.activeElement === field];
    })()`));

    expect(restored.success).toBe(true);
    expect(restored.data.result).toEqual([exact, 2, 6, "backward", false]);
    expect(await app.rpc("ask.list", null)).toEqual([]);
    await browser("open", "about:blank");
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&view=made&view=ask-history&daemon=1`);
    await browser("wait", ".ask-input");
    expect(JSON.parse(await browser("eval", "(() => { const field = document.querySelector('.ask-input'); return [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]; })()")).data.result).toEqual([exact, 2, 6, "backward"]);
    await browser("eval", `document.querySelector('.ask-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}))`);
    await browser("wait", "--fn", "!!document.querySelector('.ask-row') && !document.querySelector('.ask-input').value");
    await expect.poll(async () => (await app.rpc("ask.list", null))[0]?.parts[0]?.placement).toEqual({ kind: "routed", workstream: original.id });
    const accepted = await app.rpc("ask.list", null);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.text).toBe(exact);
    expect((await app.rpc("rail.tree", null)).find(node => node.id === replacement.id)?.terminal_id).toBeNull();
    await browser("reload");
    await browser("wait", ".ask-input");
    expect(JSON.parse(await browser("eval", "document.querySelector('.ask-input').value")).data.result).toBe("");
    expect(await app.rpc("ask.list", null)).toHaveLength(1);
  } finally {
    await browser("close");
    rmSync(profile, { recursive: true, force: true });
    await real.stop();
  }
}, 60_000);

it.skipIf(!captureDir("U3021c"))("u3021c_ask_selected_revision_browser_focus", async () => {
  const real = await startRealDaemon({}, true);
  const profile = mkdtempSync(join(tmpdir(), "selected-ask-profile-"));
  const session = `selected-ask-${process.pid}`;
  writeFileSync(join(profile, "config.json"), "{}");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", join(profile, "config.json"), "--session", session, "--profile", profile, ...args], { env, timeout: 60_000 })).stdout;
  // SAFETY: agent-browser serialises the evaluated JSON value.
  const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;
  const app = createServedApp(real.base);

  try {
    const original = await app.rpc("rail.createWorkstream", { name: "Captured", parent: null });

    for (let n = 0; n < 10; n += 1) await app.rpc("rail.createWorkstream", { name: `Work ${n}`, parent: null });
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&view=made&view=ask-history&daemon=1`);
    await browser("wait", ".ask-input");
    // Mount the owner once in an isolated document. Selection changes its props, never its lifetime.
    await browser("eval", `(async () => {
      const source = await (await fetch('/src/ask/AskBar.tsx')).text();
      const paths = source.split('"').filter(path => path.includes('/deps/'));
      const { createComponent, createSignal } = await import(paths.find(path => path.includes('/solid-js.js')));
      const { render } = await import(paths.find(path => path.includes('/solid-js_web.js')));
      const { connectProject, ConnectedProjectContext } = await import('/src/state/connectedProject.ts');
      const { createServedApp } = await import('/src/testing/realSeam.ts');
      const { AskBar } = await import('/src/ask/AskBar.tsx');
      const { Keys } = await import('/src/keys/Keys.tsx');
      const app = createServedApp(location.origin);
      const calls = [];
      const rpc = app.rpc;
      app.rpc = (method, params) => { calls.push(method); return rpc(method, params); };
      const connected = await connectProject(app, { path: ${JSON.stringify(real.dir)}, name: 'Selected Ask' }, () => false, Date.now);
      await connected.rail.settled();
      const [recovery, select] = createSignal();
      const root = document.createElement('div');
      root.className = 'window';
      document.body.replaceChildren(root);
      render(() => createComponent(ConnectedProjectContext.Provider, { value: connected, get children() {
        return [createComponent(Keys, {}), createComponent(AskBar, { get recovery() { return recovery(); } })];
      } }), root);
      const target = { surface: 'ask', object: 'ask-bar', recipient: null };
      const a = connected.drafts.edit(target, { text: '@Captured  é 🌿\\n次の行  ', workstream: ${JSON.stringify(original.id)}, name: 'Captured' }, { start: 2, end: 8, direction: 'backward' }, 'ordinary').draft;
      connected.drafts.submit(a.revision); connected.drafts.settle(a.revision, 'unknown');
      const b = connected.drafts.edit(target, { text: 'newer B', workstream: null, name: null }, { start: 1, end: 4, direction: 'forward' }, 'ordinary').draft;
      const write = Storage.prototype.setItem;
      try {
        Storage.prototype.setItem = () => { throw new Error('storage full'); };
        connected.drafts.setSelection(a.revision, a.selection);
      } finally { Storage.prototype.setItem = write; }
      window.__selectedAsk = { connected, a, b, calls, select };
    })()`);
    await browser("wait", "--fn", "document.querySelector('.ask-input')?.value === 'newer B' && !document.querySelector('.made [aria-busy=true]')");
    const output = captureDir("U3021c")!;

    mkdirSync(output, { recursive: true });
    await browser("screenshot", join(output, "ask-before-open.png"));
    writeFileSync(join(output, "ask-before-open.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    await browser("eval", "window.__selectedAsk.before = [...window.__selectedAsk.calls]; window.__selectedAsk.retained = window.__selectedAsk.connected.drafts.list(); window.__selectedAsk.select({ project: window.__selectedAsk.connected.project.path, revision: window.__selectedAsk.a.revision });");
    await browser("wait", "--fn", "document.activeElement === document.querySelector('.ask-input') && document.querySelector('.ask-input').selectionDirection === 'backward'");
    expect(await evaluate("(() => { const f = document.querySelector('.ask-input'); return [f.value, f.selectionStart, f.selectionEnd, f.selectionDirection]; })()")).toEqual(["@Captured  é 🌿\n次の行  ", 2, 8, "backward"]);
    expect(await evaluate("window.__selectedAsk.calls")).toEqual(await evaluate("window.__selectedAsk.before"));
    expect(await evaluate("window.__selectedAsk.connected.drafts.list()")).toEqual(await evaluate("window.__selectedAsk.retained"));
    await browser("screenshot", join(output, "selected-ask.png"));
    writeFileSync(join(output, "selected-ask.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  } finally {
    await browser("close").catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
    await real.stop();
  }
}, 60_000);


it.skipIf(!captureDir("DV6"))("dv6_bound_share_pointer_and_keyboard_keep_identity_on_the_dense_failure_screen", async () => {
  const real = await startRealDaemon({}, true);
  const profile = mkdtempSync(join(tmpdir(), "dv6-profile-"));
  const session = `dv6-${process.pid}`;
  writeFileSync(join(profile, "config.json"), "{}");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", join(profile, "config.json"), "--session", session, "--profile", profile, ...args], { env, timeout: 60_000 })).stdout;
  // SAFETY: agent-browser serialises the evaluated JSON value.
  const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;
  const app = createServedApp(real.base);
  const output = captureDir("DV6")!;

  const capture = async (name: string) => {
    mkdirSync(output, { recursive: true });
    await browser("screenshot", join(output, `${name}.png`));
    writeFileSync(join(output, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  };

  try {
    for (let n = 0; n < 12; n += 1) await app.rpc("deliverable.publish", { key: `dense-${n}`, title: n === 11 ? "Long published result " + "成果📖".repeat(35) : "Same title", target: { kind: "external", url: `https://example.com/${"long-target/".repeat(12)}${n}` } });
    await app.rpc("pad.create", { name: "selected-pad", text: "Published revision" });
    const pad = await app.rpc("pad.read", { name: "selected-pad" });
    const record = await app.rpc("deliverable.publish", { key: "selected", title: "Same title", target: { kind: "pad", name: pad.name, incarnation: pad.incarnation, revision: pad.revision } });
    await real.restart();
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&view=made&view=ask-history&daemon=1`);
    await browser("wait", "--fn", "document.querySelectorAll('.made-row').length === 13");
    await capture("before");
    // A browser has no native host menu. Preserve its selection boundary while the App,
    // publication reader and clipboard calls run against the real Project.
    await browser("eval", `(async () => {
      const source = await (await fetch('/src/ask/AskBar.tsx')).text();
      const paths = source.split('"').filter(path => path.includes('/deps/'));
      const { createComponent } = await import(paths.find(path => path.includes('/solid-js.js')));
      const { render } = await import(paths.find(path => path.includes('/solid-js_web.js')));
      const { createServedApp } = await import('/src/testing/realSeam.ts');
      const { App } = await import('/src/App.tsx');
      const app = createServedApp(location.origin);
      window.__dv6 = { choice: 'copy-link', copied: [], menus: [] };
      app.showContextMenu = async entries => { window.__dv6.menus.push(entries); return window.__dv6.choice; };
      app.writeClipboardText = async text => { window.__dv6.copied.push(text); };
      const root = document.createElement('div');
      root.id = 'root';
      document.body.replaceChildren(root);
      render(() => createComponent(App, { app, reducedMotion: () => true, clock: () => 0 }), root);
      window.__dv6.projectMenu = (await import('/src/testing/menuProbe.ts')).projectMenu;
    })()`);
    // Deliver the native menu's published action through the host event seam.
    await browser("wait", "--fn", "window.__dv6.projectMenu.items.some(item => item.id === 'view:made' && item.enabled)");
    await evaluate("window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:window.__dv6.projectMenu.path,command:'view:made'}}))");
    await browser("wait", "--fn", "document.querySelectorAll('.made-row').length === 13");
    const row = `.made-row[data-deliverable="${record.id}"]`;
    await evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({ block: 'center' })`);
    // macOS sends contextmenu on press, then pointerup; Linux Chromium orders it later.
    await browser("eval", `(() => {
      const button = document.querySelector(${JSON.stringify(row)} + ' button');
      button.dispatchEvent(new PointerEvent('pointerdown', {pointerType:'mouse',button:2,buttons:2,bubbles:true}));
      button.dispatchEvent(new MouseEvent('contextmenu', {button:2,buttons:2,bubbles:true,cancelable:true}));
      button.dispatchEvent(new PointerEvent('pointerup', {pointerType:'mouse',button:2,buttons:0,bubbles:true}));
    })()`);
    await browser("wait", "--fn", "window.__dv6.copied.length === 1");
    const url = `roundup://deliverable/${record.id}?project=${record.project}`;
    expect(await evaluate("window.__dv6.copied.map(text => text.split('\\n').slice(0, 2).join('\\n'))")).toEqual([`${url}\nrup link read ${url}`]);
    await capture("copied");
    await browser("focus", `${row} button`);
    await browser("eval", `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ContextMenu',bubbles:true,cancelable:true}))`);
    await browser("wait", "--fn", "window.__dv6.copied.length === 2");
    expect(await evaluate("window.__dv6.copied.map(text => text.split('\\n').slice(0, 2).join('\\n'))")).toEqual([`${url}\nrup link read ${url}`, `${url}\nrup link read ${url}`]);
    await capture("keyboard-copied");
    await app.rpc("pad.delete", { name: pad.name });
    await browser("focus", `${row} button`);
    await browser("eval", `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'F10',shiftKey:true,bubbles:true,cancelable:true}))`);
    await browser("wait", "--fn", "!!document.querySelector('.made [role=alert]')");
    expect(await evaluate("window.__dv6.copied.length")).toBe(2);
    expect(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(row)} + ' button')`)).toBe(true);
    await capture("unavailable");
  } finally {
    await browser("close").catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
    await real.stop();
  }
}, 60_000);
