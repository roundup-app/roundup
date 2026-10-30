import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir } from "../testing/captures";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { appServer, type AppServer } from "../testing/appServer";

const output = [captureDir("U461") ?? "", captureDir("U462") ?? "", captureDir("U461a") ?? ""];

const run = output.some(Boolean) ? describe : describe.skip;

run("u461 and u462 isolated rendered observers", () => {
  let server: AppServer;
  let baseline: ViteDevServer | undefined;
  let cache: string;
  let real: StartedDaemon | undefined;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), "u461-vite-"));
    server = await appServer();
    const baseRoot = process.env.U461_BASE_ROOT;

    if (baseRoot) {
      baseline = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), cacheDir: join(cache, "base"), server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "silent" });
      await baseline.listen();
    }
  }, 120_000);

  afterAll(async () => {
    await real?.stop();
    await server?.close();
    await baseline?.close();

    if (cache) await rm(cache, { recursive: true, force: true });
  });

  it("u461_drawer_rendered_hierarchy", async () => {
    const origin = server.resolvedUrls.local[0]!;

    if (baseline) await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "baseline", baseline.resolvedUrls!.local[0]!, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "fake", origin, ...output], { timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
  }, 60_000);

  it.runIf(Boolean(captureDir("U461a")))("u461a_reopen_rendered", async () => {
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-fake", server.resolvedUrls.local[0]!, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  }, 60_000);

  it.runIf(Boolean(captureDir("U461a")))("u461a_each_surface_reopens_by_pointer_and_space", async () => {
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-surfaces", server.resolvedUrls.local[0]!, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  }, 60_000);

  it("u461a_real_daemon_user_and_agent_reopen extends u462_real_daemon_history_and_reads", async () => {
    // E10: the Door's Claude is the pinned one, its model aimock serving this file's turns.
    real = await startRealDaemon({}, true, undefined, join(process.cwd(), "src/testing/fixtures/u461_door_todos.json"));
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-real", real.base, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    await real.restart();
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-restart", real.base, ...output], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    await real.model!.assertMatched();
  }, 60_000);
});


describe.skipIf(!captureDir("U3728"))("u3728 isolated rendered observer", () => {
  let server: AppServer;

  beforeAll(async () => { server = await appServer(); });
  afterAll(async () => { await server?.close(); });

  it("u3728_drawer_rendered", async () => {
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "u3728", server.resolvedUrls.local[0]!, "", "", "", captureDir("U3728")!], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  }, 60_000);
});


describe.skipIf(!captureDir("U461b"))("u461b browser environment", () => {
  let server: AppServer;
  let output: string;
  const driver = async (mode: string, directory = output) => promisify(execFile)("python3", ["src/todos/u461_browser.test.py", mode, server.resolvedUrls.local[0]!, directory], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });

  beforeAll(async () => {
    server = await appServer();
    output = await mkdtemp(join(tmpdir(), "u461b-captures-"));
  });

  afterAll(async () => {
    await server?.close();

    if (output) await rm(output, { recursive: true, force: true });
  });

  it.each(["light", "dark"])("u461b_fresh_profile_uses_requested_emulation %s", async (scheme) => {
    await driver(`emulation-${scheme}`);
  }, 60_000);

  it("u461b_capture_requires_observed_emulation", async () => {
    const valid = captureDir("U461b")!;

    await driver("capture-valid", valid);
    const readings: { environment: { width: number; height: number; dark: boolean } } = JSON.parse(await readFile(join(valid, "capture-valid.json"), "utf8"));

    expect(readings.environment).toEqual({ width: 1512, height: 950, dark: true });
    expect((await readFile(join(valid, "capture-valid.png"))).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    for (const mode of ["capture-viewport-mismatch", "capture-scheme-mismatch"]) {
      const directory = join(output, mode);

      await mkdir(directory);
      await expect(driver(mode, directory)).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/expected.*1512.*950.*True.*observed/s) });
      expect(await readdir(directory)).toEqual([]);
    }
  }, 60_000);
});


it.skipIf(!captureDir("U3021c"))("u3021c_open_restores_exact_revision_without_rpc_todo_browser_focus", async () => {
  const server = await appServer();
  const session = `todo-selected-${process.pid}`;
  const browser = async (...args: string[]) => (await promisify(execFile)("agent-browser", ["--session", session, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async (source: string) => JSON.parse(await browser("eval", source));

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?view=workstreams&items=1&tabs=1&seed=tree-40`);
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
}, 60_000);

describe("u3789a connected browser rows", () => {
  let real: StartedDaemon;

  // Compiling and warming the isolated App must not consume the interaction test's 60 s.
  beforeAll(async () => { real = await startRealDaemon({}, true); }, 120_000);
  afterAll(async () => { await real?.stop(); });

  it("u3789a_real_daemon_rows", async () => {
    const execute = promisify(execFile);
    const profile = await mkdtemp(join(tmpdir(), "u3789-real-"));
    const session = `u3789-real-${process.pid}`;

    const browser = async (...args: string[]) => {
      const { stdout } = await execute("agent-browser", ["--session", session, "--profile", profile, "--json", ...args], { timeout: 60_000 });
      const reply = JSON.parse(stdout);

      if (!reply.success) throw new Error(reply.error);

      return reply.data;
    };

    const evaluate = async (source: string) => (await browser("eval", source)).result;
    const until = async (source: string) => { await browser("wait", "--fn", source); };

    const app = createServedApp(real.base);

    try {
      const home = await app.rpc("rail.createWorkstream", { name: "row work", parent: null });
      const door = await app.rpc("rail.startDoor", { id: home.id });
      const child = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: home.id, model: null, effort: null });
      const todo = await app.rpc("todo.create", { title: "row todo", body: "keep body", blockers: null });
      await app.rpc("todo.move", { id: todo.id, home: home.id });
      const pad = await app.rpc("pad.create", { name: "row pad", text: "keep text" });
      await app.rpc("pad.move", { name: pad.name, home: home.id });
      await browser("set", "viewport", "1512", "950");
      await browser("set", "media", "dark");
      await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
      await until(`document.querySelector('.rail-row[data-id="${home.id}"]')`);
      await evaluate(`(() => {
        window.__rowCalls = [];
        const fetch = window.fetch;
        window.fetch = (...args) => { if (String(args[0]).endsWith('/__daemon/rpc')) window.__rowCalls.push(JSON.parse(args[1].body)); return fetch(...args); };
      })()`);
      await browser("click", `.rail-row[data-id="${child.id}"] .name`);
      await until(`document.activeElement?.closest('[data-id]')?.dataset.id === '${child.id}'`);
      expect(await evaluate("window.__rowCalls.filter(call => ['agent.spawn','agent.resume','rail.startDoor'].includes(call.method))")).toEqual([]);
      expect(await evaluate("!!document.querySelector('.bubble:not([hidden])')")).toBe(false);
      await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true,cancelable:true}))");
      await until("document.activeElement?.closest('.pane-screen')");
      await browser("focus", `.rail-row[data-id="${home.id}"]`);
      await until(`document.activeElement?.matches('.rail-row[data-id="${home.id}"]')`);
      await browser("press", "Enter");
      await until(`document.querySelector('.rail-row[data-id="${home.id}"]')?.dataset.selected === 'true'`);
      await evaluate("(() => {const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();})()");

      for (const kind of ["todo", "pad"]) {
        if (kind === "pad") {
          await evaluate("(() => {window.__rowCalls = []; const fetch = window.fetch; window.fetch = (...args) => { if (String(args[0]).endsWith('/__daemon/rpc')) window.__rowCalls.push(JSON.parse(args[1].body)); return fetch(...args); };})()");
          await browser("click", "#shelf-tab-pads");
        }

        await evaluate("document.querySelector('.shelf [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()");
        const row = kind === "todo" ? `.todos-tab [data-todo="${todo.id}"] .todo-row-button` : '.pads-tab [data-pad="row pad"] .pad-name';
        await until(`document.querySelector('${row}')`);
        await evaluate("window.__rowCalls.length = 0");
        await browser("click", row);
        await until(`document.activeElement === document.querySelector('${row}')`);
        expect(await evaluate("window.__rowCalls.filter(call => ['todo.get','todo.readHistory','todo.getHistory','pad.read','agent.spawn','agent.resume','rail.startDoor'].includes(call.method))")).toEqual([]);

        await browser("press", "Enter");
        await until("document.querySelector('.drawer[data-open=true]')");
        await browser("click", ".drawer .close");
        await until("!document.querySelector('.drawer[data-open=true]')");
        await browser("focus", row);

        expect(await evaluate(`window.__rowCalls.filter(call => call.method === '${kind === "todo" ? "todo.getHistory" : "pad.read"}').length`)).toBe(1);
        await browser("press", "F2");
        await until("document.activeElement?.getAttribute('aria-label') === 'Name'");
        await browser("fill", "input[aria-label=Name]", `renamed ${kind}`);
        await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true,cancelable:true}))");
        await until("!document.querySelector('.row-name-editor')");
        expect(await evaluate(`window.__rowCalls.filter(call => call.method === '${kind === "todo" ? "todo.update" : "pad.rename"}').length`)).toBe(1);
        const renamedRow = kind === "todo" ? row : `[data-incarnation="${pad.incarnation}"] .pad-name`;
        await browser("focus", renamedRow);
        await browser("press", "Enter");
        await until("document.querySelector('.drawer[data-open=true]')");
        await browser("click", ".drawer .close");
        await until("!document.querySelector('.drawer[data-open=true]')");
        await browser("reload");
        await until("document.querySelector('.shelf-tabs')");
      }

      const renamedTodo = (await app.rpc("todo.list", null)).find(item => item.id === todo.id);
      const renamedPad = (await app.rpc("pad.list", null)).find(item => item.incarnation === pad.incarnation);
      expect(renamedTodo).toMatchObject({ title: "renamed todo", body: "keep body", home: home.id, creator: todo.creator });
      expect(renamedPad).toMatchObject({ name: "renamed pad", text: "keep text", home: home.id, revision: pad.revision });
      expect((await app.rpc("rail.tree", null)).find(node => node.id === home.id)?.attempt).toBe(door.attempt);
    } catch (error) {
      console.error(await evaluate("({calls:window.__rowCalls,active:document.activeElement?.outerHTML})"));
      console.error(await browser("snapshot"));
      console.error(await browser("errors"));
      throw error;
    } finally {
      try { await browser("close"); } finally { await rm(profile, { recursive: true, force: true }); }
    }
  }, 60_000);
});
