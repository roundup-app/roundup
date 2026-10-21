import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir } from "../testing/captures";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { appServer, type AppServer } from "../testing/appServer";

const output = [captureDir("U461") ?? "", captureDir("U462") ?? "", captureDir("U461a") ?? ""];

const run = captureDir("U461") && (captureDir("U462") || captureDir("U461a")) ? describe : describe.skip;

run("u461 and u462 isolated rendered observers", () => {
  let server: AppServer;
  let baseline: ViteDevServer | undefined;
  let cache: string;
  let real: StartedDaemon;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), "u461-vite-"));
    server = await appServer();
    const baseRoot = process.env.U461_BASE_ROOT;

    if (baseRoot) {
      baseline = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), cacheDir: join(cache, "base"), server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "silent" });
      await baseline.listen();
    }

    // E10: the Door's Claude is the pinned one, its model aimock serving this file's turns.
    if (captureDir("U462")) real = await startRealDaemon({}, true, undefined, join(process.cwd(), "src/testing/fixtures/u461_door_todos.json"));
  }, 120_000);

  afterAll(async () => {
    await real?.stop();
    await server?.close();
    await baseline?.close();

    if (cache) await rm(cache, { recursive: true, force: true });
  });

  it.skipIf(!captureDir("U462"))("u461_drawer_rendered_hierarchy", async () => {
    const origin = server.resolvedUrls.local[0]!;

    if (baseline) await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "baseline", baseline.resolvedUrls!.local[0]!, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "fake", origin, ...output], { timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
  }, 300_000);

  it.skipIf(!captureDir("U462"))("u462_real_daemon_history_and_reads", async () => {
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "real", real.base, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    await real.restart();
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "restart", real.base, ...output], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    await real.model!.assertMatched();
  }, 300_000);
  it.skipIf(!captureDir("U461a"))("u461a_reopen_rendered", async () => {
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-fake", server.resolvedUrls.local[0]!, ...output], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  }, 120_000);

  it.skipIf(!captureDir("U461a"))("u461a_real_daemon_user_and_agent_reopen", async () => {
    const reopening = await startRealDaemon({}, true);

    try {
      await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-real", reopening.base, ...output, reopening.dir], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      await reopening.restart();
      await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-restart", reopening.base, ...output], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
    } finally {
      await reopening.stop();
    }
  }, 240_000);

});


it.skipIf(!captureDir("U3021c"))("u3021c_open_restores_exact_revision_without_rpc_todo_browser_focus", async () => {
  const server = await appServer();
  const session = `todo-selected-${process.pid}`;
  const browser = async (...args: string[]) => (await promisify(execFile)("agent-browser", ["--session", session, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async (source: string) => JSON.parse(await browser("eval", source));

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
    await browser("set", "media", "dark");
    await browser("wait", "#shelf-tab-todos");
    await browser("eval", `(async () => {
      const source = await (await fetch('/src/todos/TodoDrawer.tsx')).text();
      const paths = source.split('"').filter(path => path.includes('/deps/'));
      const { createComponent } = await import(paths.find(path => path.includes('/solid-js.js')));
      const { render } = await import(paths.find(path => path.includes('/solid-js_web.js')));
      const { connectProject, ConnectedProjectContext } = await import('/src/state/connectedProject.ts');
      const { TodoDrawer } = await import('/src/todos/TodoDrawer.tsx');
      const { DrawerHost } = await import('/src/drawer/DrawerHost.tsx');
      const app = window.__fake.app;
      const all = await app.rpc('todo.list', null);
      const original = all[0];
      const connected = await connectProject(app, app.opened.project, () => true, Date.now);
      const destination = { surface: 'todos', object: String(original.id), recipient: 'body' };
      const form = { text: '  A é 🧪\\n次の行  ', base: original.body, home: original.home, expected_change: 1, title: original.title, body: original.body, done: original.done, blockers: original.blockers.map(String) };
      const a = connected.drafts.edit(destination, form, { start: 2, end: 5, direction: 'backward' }, 'ordinary').draft;
      connected.drafts.submit(a.revision);
      connected.drafts.settle(a.revision, 'failed');
      const b = connected.drafts.edit(destination, { ...form, text: 'newer B' }, { start: 1, end: 3, direction: 'forward' }, 'ordinary').draft;
      const list = { project: connected.project.path, all: () => all, byId: () => new Map(all.map(todo => [todo.id, todo])), isLoaded: () => true, failure: () => null, reload: async () => {} };
      const root = document.createElement('div');
      document.querySelector('.window .overlay').append(root);
      render(() => createComponent(ConnectedProjectContext.Provider, { value: connected, get children() { return createComponent(DrawerHost, { drawer: connected.drawer, reducedMotion: () => true }); } }), root);
      const show = revision => connected.drawer.open(() => createComponent(ConnectedProjectContext.Provider, { value: connected, get children() { return createComponent(TodoDrawer, { id: original.id, todos: list, recovery: { project: connected.project.path, revision } }); } }), 'key');
      window.__selectedTodo = { connected, app, a, b, list, show, calls: [...app.calls], retained: connected.drafts.list() };
      show(a.revision);
    })()`);
    await browser("wait", "textarea[aria-label=Body]");
    expect(await evaluate(`(() => { const f = document.querySelector('textarea[aria-label=Body]'); return [f.value, f.selectionStart, f.selectionEnd, f.selectionDirection]; })()`)).toEqual(["  A é 🧪\n次の行  ", 2, 5, "backward"]);
    await browser("click", ".todo-detail-title");
    expect(await evaluate("[window.__selectedTodo.app.calls, window.__selectedTodo.connected.drafts.list()]")).toEqual(await evaluate("[window.__selectedTodo.calls, window.__selectedTodo.retained]"));
    const output = captureDir("U3021c")!;

    await mkdir(output, { recursive: true });
    await browser("screenshot", join(output, "selected-todo-body.png"));
    await writeFile(join(output, "selected-todo.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    await browser("eval", "window.__selectedTodo.show(window.__selectedTodo.b.revision)");
    await browser("wait", "--fn", "document.querySelector('textarea[aria-label=Body]')?.value === 'newer B'");
    expect(await evaluate("[window.__selectedTodo.app.calls, window.__selectedTodo.connected.drafts.list()]")).toEqual(await evaluate("[window.__selectedTodo.calls, window.__selectedTodo.retained]"));
    await browser("screenshot", join(output, "selected-todo-newer.png"));
    await browser("eval", `(async () => {
      const p = window.__selectedTodo;
      const source = await (await fetch('/src/todos/Todos.tsx')).text();
      const paths = source.split('"').filter(path => path.includes('/deps/'));
      const { createComponent } = await import(paths.find(path => path.includes('/solid-js.js')));
      const { ConnectedProjectContext } = await import('/src/state/connectedProject.ts');
      const { Todos } = await import('/src/todos/Todos.tsx');
      const destination = { surface: 'todos', object: 'new', recipient: null };
      const a = p.connected.drafts.edit(destination, { title: '  creation é 🧪  ', home: null }, { start: 2, end: 7, direction: 'backward' }, 'ordinary').draft;
      p.connected.drafts.submit(a.revision);
      p.connected.drafts.settle(a.revision, 'failed');
      p.connected.drafts.edit(destination, { title: 'newer creation B', home: null }, null, 'ordinary');
      p.retained = p.connected.drafts.list();
      p.calls = [...p.app.calls];
      p.connected.drawer.open(() => createComponent(ConnectedProjectContext.Provider, { value: p.connected, get children() { return createComponent(Todos, { recovery: { project: p.connected.project.path, revision: a.revision, list: p.list } }); } }), 'key');
    })()`);
    await browser("wait", ".entry-field");
    expect(await evaluate(`(() => { const f = document.querySelector('.entry-field'); return [f.value, f.selectionStart, f.selectionEnd, f.selectionDirection]; })()`)).toEqual(["  creation é 🧪  ", 2, 7, "backward"]);
    await browser("screenshot", join(output, "selected-todo-creation.png"));
    await browser("click", ".drawer .close");
    expect(await evaluate("[window.__selectedTodo.app.calls, window.__selectedTodo.connected.drafts.list()]")).toEqual(await evaluate("[window.__selectedTodo.calls, window.__selectedTodo.retained]"));
    await browser("eval", `(async () => {
      const p = window.__selectedTodo;
      const original = p.list.all()[0];
      const blocker = p.list.all()[1];
      const source = await (await fetch('/src/todos/TodoDrawer.tsx')).text();
      const paths = source.split('"').filter(path => path.includes('/deps/'));
      const { createComponent } = await import(paths.find(path => path.includes('/solid-js.js')));
      const { ConnectedProjectContext } = await import('/src/state/connectedProject.ts');
      const { TodoDrawer } = await import('/src/todos/TodoDrawer.tsx');
      const destination = { surface: 'todos', object: String(original.id), recipient: 'blockers:captured' };
      const form = { home: original.home, title: original.title, body: original.body, done: original.done, blockers: [String(blocker.id)], baseBlockers: [], expected_change: 1,
        originalTitle: original.title, originalBody: original.body, originalDone: original.done, originalBlockers: [], originalChange: 1, action: 'add', blocker: blocker.id };
      const a = p.connected.drafts.edit(destination, form, null, 'ordinary').draft;
      p.connected.drafts.submit(a.revision);
      p.connected.drafts.settle(a.revision, 'failed');
      p.connected.drafts.edit(destination, { ...form, blockers: [] }, null, 'ordinary');
      p.retained = p.connected.drafts.list();
      p.calls = [...p.app.calls];
      p.connected.drawer.open(() => createComponent(ConnectedProjectContext.Provider, { value: p.connected, get children() { return createComponent(TodoDrawer, { id: original.id, todos: p.list, recovery: { project: p.connected.project.path, revision: a.revision } }); } }), 'key');
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error('disk full'); };
      try { p.connected.drafts.setSelection(a.revision, null); } finally { Storage.prototype.setItem = write; }
    })()`);
    await browser("wait", ".todo-dependencies");
    expect(await evaluate("[window.__selectedTodo.app.calls, window.__selectedTodo.connected.drafts.list()]")).toEqual(await evaluate("[window.__selectedTodo.calls, window.__selectedTodo.retained]"));
    await browser("screenshot", join(output, "selected-todo-blocker-retention-failure.png"));
    await writeFile(join(output, "selected-todo-blocker.checks.json"), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  } finally {
    await browser("close");
    await server.close();
  }
}, 90_000);
