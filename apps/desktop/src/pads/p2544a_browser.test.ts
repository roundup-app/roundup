import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";

const execute = promisify(execFile);

const session = `p2544a-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => {
  const { stdout } = await execute("agent-browser", ["--session", session, ...args], { timeout: 60_000 });

  return stdout;
};

const evaluate = async (source: string) => JSON.parse(await browser("eval", source));

beforeAll(async () => {
  server = await appServer();
  await browser("set", "viewport", "1512", "950");
}, 90_000);

afterAll(async () => {
  await browser("close");
  await server?.close();
});

const open = async (readonly = false, text?: string) => {
  await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
  // Each case starts with fresh durable drafts; in-case reopen still exercises retention.
  await browser("eval", "localStorage.clear()");
  await browser("reload");
  await browser("wait", "#shelf-tab-pads");

  if (text !== undefined) await browser("eval", `window.__fake.app.rpc('pad.write', ${JSON.stringify({name: "pad-3", text})})`);

  await browser("eval", "(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); })()");
  await browser("wait", "[data-shelf-row] .pad-name");
  await browser("eval", `[...document.querySelectorAll('[data-shelf-row] .pad-name')].find(row => row.textContent === "${readonly ? "pad-2" : "pad-3"}").click()`);
  await browser("wait", ".ProseMirror");
};

const slash = async () => {
  await browser("wait", ".ProseMirror[contenteditable=true]");
  await browser("focus", ".ProseMirror");
  await browser("press", "Control+End");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/");
};

it("p2544a_slash_menu_pointer_and_keys", async () => {
  await open();
  await slash();
  await browser("wait", ".milkdown-slash-menu[data-show=true]");
  expect(await evaluate(`(() => {
    const field = document.querySelector('.ProseMirror');
    const active = document.getElementById(field.getAttribute('aria-activedescendant'));
    return [document.getElementById(field.getAttribute('aria-controls'))?.getAttribute('role'),
      active?.getAttribute('role'), active?.getAttribute('aria-selected'), active?.dataset.index];
  })()`)).toEqual(["listbox", "option", "true", "0"]);
  await browser("click", ".milkdown-slash-menu li[data-index='1']");
  await browser("keyboard", "type", "Pointer heading");
  expect(await evaluate("document.querySelector('.ProseMirror h1:last-child')?.textContent")).toBe("Pointer heading");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/");
  await browser("wait", ".milkdown-slash-menu[data-show=true]");
  await browser("press", "ArrowDown");
  expect(await evaluate(`document.getElementById(document.querySelector('.ProseMirror')
    .getAttribute('aria-activedescendant'))?.dataset.index`)).toBe("1");
  await browser("press", "ArrowDown");
  await browser("press", "ArrowUp");
  await browser("press", "Enter");
  await browser("keyboard", "type", "Keyboard heading");
  expect(await evaluate("document.querySelector('.ProseMirror h1:last-child')?.textContent")).toBe("Keyboard heading");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/");
  await browser("wait", ".milkdown-slash-menu[data-show=true]");
  const before = await evaluate("document.querySelector('.ProseMirror').textContent");

  await browser("press", "Escape");
  expect(await evaluate("document.querySelector('.ProseMirror').hasAttribute('aria-activedescendant')")).toBe(false);
  expect(await evaluate("document.querySelector('.ProseMirror').textContent")).toBe(before);
  await browser("keyboard", "type", "continued");
  expect(await evaluate("document.querySelector('.ProseMirror').textContent.endsWith('/continued')")).toBe(true);
}, 180_000);

it("p2544a_drag_reorders_and_saves", async () => {
  await open(false, "First paragraph\n\nSecond paragraph\n\nThird paragraph\n");
  await browser("hover", ".ProseMirror p:nth-child(3)");
  await browser("wait", ".milkdown-block-handle[data-show=true]");
  await browser("drag", ".milkdown-block-handle .operation-item:last-child", ".ProseMirror p:first-child");
  expect(await evaluate("[...document.querySelectorAll('.ProseMirror p')].map(p => p.textContent)")).toEqual([
    "First paragraph", "Third paragraph", "Second paragraph",
  ]);
  await browser("click", ".pad-head-name");
  await browser("wait", "--fn", "window.__fake.app.calls.some(c => c.method === 'pad.write')");
  expect(await evaluate("window.__fake.app.rpc('pad.list').then(pads => pads.find(p => p.name === 'pad-3').text)")).toBe(
    "First paragraph\n\nThird paragraph\n\nSecond paragraph\n",
  );
}, 180_000);

it("p2544a_readonly_blocks_do_not_write", async () => {
  await open(true);
  const before = await evaluate("document.querySelector('.ProseMirror').textContent");

  await browser("click", ".ProseMirror p:first-of-type");
  await browser("keyboard", "type", "/changed");
  await browser("hover", ".ProseMirror p:first-of-type");
  expect(await evaluate("document.querySelector('.ProseMirror').textContent")).toBe(before);
  expect(await evaluate("Boolean(document.querySelector('.milkdown-block-handle[data-show=true]'))")).toBe(false);
  expect(await evaluate("window.__fake.app.calls.filter(c => c.method === 'pad.write')")).toEqual([]);
}, 180_000);

const visualSource = 'Agent prose.\n\n```mermaid\ngraph LR\nA-->B\n```\n\n```excalidraw\n{"type":"excalidraw","elements":[]}\n```\n\nTail prose.\n';

it("p2544e_visual_blocks_survive_autosave", async () => {
  await open(false, visualSource);
  await browser("wait", ".visual-mermaid svg");
  await browser("wait", ".visual-drawing .excalidraw");
  await browser("focus", ".ProseMirror");
  await browser("press", "Control+Home");
  await browser("keyboard", "type", "Reviewed ");
  await browser("wait", "[data-state=saved]");
  const edited = `Reviewed ${visualSource}`;
  const source = () => evaluate("window.__fake.app.rpc('pad.read', {name:'pad-3'}).then(p => p.text)");

  expect(await source()).toBe(edited);
  await browser("click", ".drawer .close");
  await browser("eval", "[...document.querySelectorAll('[data-shelf-row] .pad-name')].find(row => row.textContent === 'pad-3').click()");
  await browser("wait", ".visual-mermaid svg");
  await browser("wait", ".visual-drawing .excalidraw");
  await browser("click", ".visual-mermaid");
  await browser("wait", ".visual-source.is-open");
  await browser("press", "End");
  await browser("press", "ArrowDown");
  await browser("press", "End");
  await browser("press", "Backspace");
  await browser("keyboard", "type", "C");
  await browser("wait", "[data-state=saved]");
  expect(await source()).toBe(edited.replace("A-->B", "A-->C"));
  await browser("click", ".ProseMirror p:first-of-type");
  await browser("wait", ".visual-mermaid svg");
  expect(await evaluate("Boolean(document.querySelector('.visual-drawing .excalidraw'))")).toBe(true);
  await browser("scrollintoview", ".visual-drawing canvas.interactive");
  await browser("click", ".visual-drawing label:has([data-testid=toolbar-rectangle])");

  const point = await evaluate(`(() => {
    const rect = document.querySelector('.visual-drawing canvas.interactive').getBoundingClientRect();
    return {x: Math.round(rect.x + rect.width * 0.65), y: Math.round(rect.y + rect.height * 0.6)};
  })()`);

  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(point.x + 80), String(point.y + 60));
  await browser("mouse", "up");

  const afterMermaid = edited.replace("A-->B", "A-->C");

  await expect.poll(source, { timeout: 20_000 }).not.toBe(afterMermaid);
  await browser("wait", "[data-state=saved]");

  const drawn: string = await source();
  const drawing = drawn.match(/```excalidraw\n([\s\S]*?)\n```/);

  expect(JSON.parse(drawing?.[1] ?? "null")).toMatchObject({ elements: [{ type: "rectangle" }] });
  expect(drawn.replace(/```excalidraw\n[\s\S]*?\n```/, '```excalidraw\n{"type":"excalidraw","elements":[]}\n```')).toBe(afterMermaid);
}, 240_000);


// Chromium's focus adopts its DOM caret after creation; jsdom does not exercise that reset.
it("u3021c_open_restores_exact_revision_without_rpc_browser_focus", async () => {
  await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
  await browser("eval", "localStorage.clear()");
  await browser("reload");
  await browser("set", "media", "dark");
  await browser("wait", "#shelf-tab-pads");
  await browser("eval", `(async () => {
    const moduleSource = await (await fetch('/src/pads/PadDrawer.tsx')).text();
    const dependencies = moduleSource.split('"').filter(path => path.includes('/deps/'));
    const { createComponent } = await import(dependencies.find(path => path.includes('/solid-js.js')));
    const { render } = await import(dependencies.find(path => path.includes('/solid-js_web.js')));
    const { connectProject, ConnectedProjectContext } = await import('/src/state/connectedProject.ts');
    const { PadDrawer } = await import('/src/pads/PadDrawer.tsx');
    const { DrawerHost } = await import('/src/drawer/DrawerHost.tsx');
    const app = window.__fake.app;
    const pads = await app.rpc('pad.list', null);
    const pad = pads.find(p => p.name === 'pad-3');
    const connected = await connectProject(app, app.opened.project, () => false, Date.now);
    const destination = { surface: 'pads', object: pad.incarnation, recipient: null };
    const a = connected.drafts.edit(destination, { originalName: pad.name, source: 'A 🌱 é\\nsecond', base: pad.text, baseRevision: pad.revision }, { start: 2, end: 7, direction: 'backward' }, 'ordinary').draft;
    connected.drafts.submit(a.revision);
    const b = connected.drafts.edit(destination, { ...a.value, source: 'B 🪁' }, null, 'ordinary').draft;
    connected.drafts.settle(a.revision, 'failed');
    const root = document.createElement('div');
    document.querySelector('.window .overlay').append(root);
    render(() => createComponent(ConnectedProjectContext.Provider, { value: connected, get children() { return createComponent(DrawerHost, { drawer: connected.drawer, reducedMotion: () => true }); } }), root);
    const list = { pads: () => pads, loaded: () => true, failure: () => null, reload: async () => {} };
    const show = revision => connected.drawer.open(() => createComponent(ConnectedProjectContext.Provider, { value: connected, get children() { return createComponent(PadDrawer, { name: pad.name, recovery: { project: connected.project.path, revision, list }, pads: list.pads, onLateFailure: () => {} }); } }), 'key');
    window.__selectedPad = { connected, app, b, show, calls: [...app.calls], retained: connected.drafts.list() };
    show(a.revision);
  })()`);
  await browser("wait", "[aria-label='Pad body']");
  // The restore changes no focus, and the browser shows a ProseMirror selection only in the focused editor; focus it here rather than wait on creation-time focus.
  await expect.poll(async () => {
    await evaluate("document.querySelector('[aria-label=\"Pad body\"]').focus()");

    return evaluate("window.getSelection().toString()");
  }, { timeout: 20_000 }).toBe(" 🌱 é");
  await browser("click", ".pad-head-name");
  expect(await evaluate("(() => { const p = window.__selectedPad; return [p.app.calls, p.connected.drafts.list()]; })()")).toEqual(
    await evaluate("[window.__selectedPad.calls, window.__selectedPad.retained]"),
  );

  await browser("click", "[aria-label='Pad body']");
  await browser("press", "ArrowLeft");
  expect(await evaluate(`(() => {
    const p = window.__selectedPad;
    const saved = JSON.parse(localStorage.getItem('roundup:drafts:' + p.connected.project.path)).drafts;
    return [p.connected.drafts.list().find(d => d.revision === p.b.revision), saved.find(d => d.revision === p.b.revision)];
  })()`)).toEqual(await evaluate("[window.__selectedPad.b, window.__selectedPad.b]"));
  await browser("eval", "window.__selectedPad.retained = window.__selectedPad.connected.drafts.list()");

  const output = captureDir("U3021c");

  if (output) {
    await mkdir(output, { recursive: true });
    await browser("screenshot", join(output, "selected-pad-blurred.png"));
    await writeFile(join(output, "selected-pad.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  }

  await browser("eval", "window.__selectedPad.connected.drawer.close('key')");
  await browser("wait", "--fn", "!document.querySelector('.pad-body')");
  await browser("eval", "window.__selectedPad.show(window.__selectedPad.b.revision)");
  await browser("wait", "[aria-label='Pad body']");
  expect(await evaluate("document.querySelector('[aria-label=\"Pad body\"]').textContent")).toBe("B 🪁");
  expect(await evaluate("(() => { const p = window.__selectedPad; return [p.app.calls, p.connected.drafts.list()]; })()")).toEqual(
    await evaluate("[window.__selectedPad.calls, window.__selectedPad.retained]"),
  );
}, 90_000);
