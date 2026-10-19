import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { StartedDaemon } from "./realDaemonFixture";
import { connectProject, ConnectedProjectContext, createProjectDrafts } from "../state/connectedProject";
import { showEverything } from "./showEverything";
import { DrawerHost } from "../drawer/DrawerHost";
import { Todos } from "../todos/Todos";
import { execFile } from "node:child_process";
import { connect } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as v from "valibot";
import { startRealDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";
import { chromePath } from "./chromePage";
import { captureDir } from "./captures";
import type { CreateParams as TodoCreate } from "@contracts/todo/CreateParams";
import type { CreateParams as PadCreate } from "@contracts/pad/CreateParams";
import type { Actor } from "@contracts/Actor";
import type { Todo } from "@contracts/todo/Todo";
import type { Pad } from "@contracts/pad/Pad";

const exec = promisify(execFile);

const reply = v.object({ id: v.number(), result: v.optional(v.unknown()), error: v.optional(v.object({ message: v.string() })) });

// The same identified socket as U460's ownerCall seeds provenance the user RPC cannot author.
const actorCall = (socketPath: string, actor: Actor, method: "todo.create" | "pad.create", params: TodoCreate | PadCreate) => new Promise<unknown>((resolve, reject) => {
  const socket = connect(socketPath);
  const timer = setTimeout(() => { socket.destroy(); reject(new Error(`${method} timed out`)); }, 20_000);
  let pending = "";

  const finish = (frame: v.InferOutput<typeof reply>) => {
    clearTimeout(timer);
    socket.destroy();

    if (frame.error) reject(new Error(frame.error.message));
    else resolve(frame.result);
  };

  socket.setEncoding("utf8");
  socket.on("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "daemon.identify", params: { actor } }) + "\n"));
  socket.on("error", error => { clearTimeout(timer); socket.destroy(); reject(error); });
  socket.on("data", (chunk: string) => {
    pending += chunk;

    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const frame = v.parse(reply, JSON.parse(pending.slice(0, end)));
      pending = pending.slice(end + 1);

      if (frame.error) finish(frame);
      else if (frame.id === 1) socket.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }) + "\n");
      else finish(frame);
    }
  });
});

it("u2744a_shelf_scope_real_daemon", async () => {
  const real = await startRealDaemon({}, true);
  const profile = mkdtempSync(join(tmpdir(), "u2744a-profile-"));
  const session = `u2744a-${process.pid}`;
  writeFileSync(join(profile, "config.json"), "{}");
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_"))), AGENT_BROWSER_DEFAULT_TIMEOUT: "60000" };
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", join(profile, "config.json"), "--session", session, "--profile", profile, ...args], { env, timeout: 90_000 })).stdout;
  // SAFETY: agent-browser serialises the page expression's JSON value.
  const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;
  const until = (source: string) => browser("wait", "--fn", source);
  const app = createServedApp(real.base);

  const capture = async (step: string) => {
    const dir = captureDir("shelf-scope");

    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  try {
    const w = await app.rpc("rail.createWorkstream", { name: "Shelf workstream one " + "W".repeat(60), parent: null });
    const other = await app.rpc("rail.createWorkstream", { name: "Shelf workstream two", parent: null });
    const a = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: w.id, name: "A".repeat(32) });
    const b = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: other.id, name: "Shelf maker two" });
    const root = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: "Shelf root maker" });
    const user: Actor = { kind: "user", id: "you", parent: null };
    const agent = (id: string): Actor => ({ kind: "agent", id, parent: null });
    const makers = [user, agent(a.id), agent(b.id), agent(root.id), agent(w.id), agent("absent-maker"), { kind: "ext", id: "shelf-extension", parent: null } as const];
    const homes = [null, w.id, w.id, null, w.id, w.id, null];

    for (let at = 0; at < makers.length; at++) {
      const title = at === 1 ? "T".repeat(300) : `Shelf item ${at}`;
      const made = await actorCall(join(real.dir, "rupd.sock"), makers[at]!, "todo.create", { title, body: null, blockers: null });
      const id = v.parse(v.object({ id: v.number() }), made).id;
      await app.rpc("todo.move", { id, home: homes[at]! });
      const name = at === 1 ? "p".repeat(120) : `shelf-pad-${at}`;
      await actorCall(join(real.dir, "rupd.sock"), makers[at]!, "pad.create", { name, text: "scope observer" });
      await app.rpc("pad.move", { name, home: homes[at]! });

      if (at === 2) await app.rpc("todo.complete", { id });
    }

    const rootHome = await actorCall(join(real.dir, "rupd.sock"), agent(a.id), "todo.create", { title: "root Home by workstream maker", body: null, blockers: null });
    await app.rpc("todo.move", { id: v.parse(v.object({ id: v.number() }), rootHome).id, home: null });
    await actorCall(join(real.dir, "rupd.sock"), agent(a.id), "pad.create", { name: "root-home-pad", text: "root" });
    await app.rpc("pad.move", { name: "root-home-pad", home: null });
    await app.rpc("agent.stop", { id: a.id });
    await app.rpc("agent.signal", { id: b.id, attempt: b.attempt!, payload: { hook_event_name: "SessionEnd", reason: "done" } });
    expect((await app.rpc("rail.tree", null)).find(node => node.id === b.id)?.status?.kind).toBe("done");
    const shell = await app.rpc("terminal.open", { workstream: w.id });
    const rootShell = await app.rpc("terminal.open", { workstream: null });
    await browser("set", "viewport", "1512", "950");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("wait", ".shelf-tabs");

    const select = async (id: string | null) => {
      await evaluate(`(() => { document.querySelector(${JSON.stringify(id ? `.rail-row[data-id="${id}"]` : "[data-todo-root]")}).click(); return true; })()`);
      await until(id ? `document.querySelector('.rail-row[data-selected="true"]')?.dataset.id === ${JSON.stringify(id)}` : "!document.querySelector('.rail-row[data-selected=\"true\"]')");
    };

    const tab = async (kind: "todos" | "pads") => {
      await evaluate(`(() => { const tab = document.querySelector('#shelf-tab-${kind}'); if (tab.getAttribute('aria-selected') !== 'true') tab.click(); return true; })()`);
      await until(`!!document.querySelector('#shelf-panel-${kind}:not([hidden])')`);
    };

    const expand = async () => {
      for (;;) {
        const closed = '.shelf [role="treeitem"][aria-expanded="false"] > [data-part="branch-control"]';
        const id = await evaluate<string | null>(`[...document.querySelectorAll(${JSON.stringify(closed)})].find(control => control.checkVisibility())?.closest('[data-shelf-group]').dataset.shelfGroup ?? null`);

        if (!id) break;
        const group = `.shelf [data-shelf-group="${id}"]`;

        await browser("click", `${group} > [data-part="branch-control"]`);
        await until(`document.querySelector(${JSON.stringify(group)})?.getAttribute('aria-expanded') === 'true'`);
      }

      const done = '.shelf-done-line .todo-row-button';

      if (await evaluate<boolean>(`!!document.querySelector(${JSON.stringify(done)}) && ![...document.querySelectorAll('.shelf .todo-tick:checked')].some(tick => tick.checkVisibility())`)) {
        await browser("click", done);
        await until("[...document.querySelectorAll('.shelf .todo-tick:checked')].some(tick => tick.checkVisibility())");
      }
    };

    const readback = async (id: string | null, maker = false, step?: string) => {
      const expectedTodos = (await app.rpc("todo.list", null)).filter(row => id === null || (maker ? row.creator.kind === "agent" && row.creator.id === id : row.home === id));
      const expectedPads = (await app.rpc("pad.list", null)).filter(row => id === null || (maker ? row.owner.kind === "agent" && row.owner.id === id : row.home === id));
      await tab("todos");
      expect(await evaluate("document.querySelector('#shelf-tab-todos .shelf-count')?.textContent ?? '0'")).toBe(String(expectedTodos.filter(todo => !todo.done).length));
      await expand();
      await until(`[...document.querySelectorAll('#shelf-panel-todos [data-todo]')].filter(row => row.checkVisibility()).length === ${expectedTodos.length}`);
      const todoIds = await evaluate<number[]>("[...document.querySelectorAll('#shelf-panel-todos [data-todo]')].filter(row => row.checkVisibility()).map(row => Number(row.dataset.todo))");
      expect(todoIds.toSorted((a, b) => a - b)).toEqual(expectedTodos.map(row => row.id).toSorted((a, b) => a - b));
      await tab("pads");
      expect(await evaluate("document.querySelector('#shelf-tab-pads .shelf-count')?.textContent ?? '0'")).toBe(String(expectedPads.length));
      await expand();
      await until(`[...document.querySelectorAll('#shelf-panel-pads .pad-name')].filter(row => row.checkVisibility()).length === ${expectedPads.length}`);
      expect((await evaluate<string[]>("[...document.querySelectorAll('#shelf-panel-pads .pad-name')].filter(row => row.checkVisibility()).map(row => row.textContent)")).toSorted()).toEqual(expectedPads.map(row => row.name).toSorted());

      if (step) await capture(`${step}-pads`);
      await tab("todos");
      await expand();
    };

    for (const scheme of ["light", "dark"]) {
      await browser("set", "media", scheme);
      await select(null);
      await tab("todos");
      await evaluate(`(() => { const control = document.querySelector('#shelf-panel-todos [data-shelf-group="unassigned"] [data-part="branch-control"]'); if (control.closest('[role="treeitem"]').getAttribute('aria-expanded') === 'true') control.click(); return true; })()`);
      await capture(`${scheme}-overview-folded`);
      await readback(null, false, `${scheme}-overview-open`);
      await capture(`${scheme}-overview-open`);
      const counts = await evaluate<string[]>("[...document.querySelectorAll('.shelf-count')].map(row => row.textContent)");
      const control = '#shelf-panel-todos [data-shelf-group="unassigned"] [data-part="branch-control"]';
      await browser("focus", control);

      for (const [key, expanded] of [["ArrowLeft", false], ["ArrowRight", true], ["Enter", false], ["Space", true]] as const) {
        await browser("press", key);
        await until(`document.querySelector(${JSON.stringify(control)})?.closest('[role="treeitem"]').getAttribute('aria-expanded') === '${expanded}'`);
        expect(await evaluate("document.activeElement.matches('[data-part=branch-control]')")).toBe(true);
        expect(await evaluate("[...document.querySelectorAll('.shelf-count')].map(row => row.textContent)")).toEqual(counts);
        expect(await evaluate("!document.querySelector('.rail-row[data-selected=true]')")).toBe(true);
      }

      await select(w.id);
      await readback(w.id);
      await capture(`${scheme}-workstream`);
      await browser("click", `.terminal-tab[data-bubble="${shell.terminal_id}"]`);
      await readback(w.id);
      await select(null);
      await browser("click", `.terminal-tab[data-bubble="${rootShell.terminal_id}"]`);
      await readback(null);
      await select(a.id);
      await readback(a.id, true);
      await capture(`${scheme}-agent`);
      await select(other.id);
      await readback(other.id);
      await select(b.id);
      await readback(b.id, true);
      await select(root.id);
      await readback(root.id, true);
    }

    await select(null);
    await tab("todos");
    await expand();
    // Inject one rejected completion at the webview transport; all list data and Events remain real.
    await evaluate(`(() => { const original = window.fetch.bind(window); window.fetch = (url, options) => { if (options?.body && JSON.parse(options.body).method === 'todo.complete') { window.fetch = original; return Promise.resolve(new Response(JSON.stringify({error: {code: -32000, message: 'Cannot complete this Todo: observer failure'}}), {headers: {'Content-Type': 'application/json'}})); } return original(url, options); }; return true; })()`);
    await browser("click", ".shelf .todo-tick:not(:checked):not(:disabled)");
    await until("document.querySelector('.shelf [role=alert]')?.textContent.includes('observer failure')");

    for (const scheme of ["light", "dark"]) {
      await browser("set", "media", scheme);
      await capture(`${scheme}-failure`);
    }

    await select(w.id);
    await app.rpc("rail.rename", { id: w.id, name: "Renamed Shelf workstream" });
    await until("document.querySelector('[data-shelf-scope]')?.textContent === 'Renamed Shelf workstream'");
    const all: Todo[] = await app.rpc("todo.list", null);
    await app.rpc("todo.move", { id: all.find(row => row.creator.id === a.id)!.id, home: other.id });
    const allPads: Pad[] = await app.rpc("pad.list", null);
    const changedPad = allPads.find(row => row.owner.id === a.id)!.name;
    await app.rpc("pad.setOwner", { name: changedPad, owner: user });
    await app.rpc("pad.move", { name: changedPad, home: other.id });
    await readback(w.id);
    await select(a.id);
    await readback(a.id, true);

    for (const scheme of ["light", "dark"]) {
      await browser("set", "media", scheme);
      await browser("open", `${real.base}/harness.html?seed=first-run`);
      await browser("wait", ".shelf-tabs");
      await capture(`${scheme}-first-run`);
    }
  } finally {
    await browser("close").catch(() => undefined);
    await real.stop();
    rmSync(profile, { recursive: true, force: true });
  }
}, 360_000);


describe("u2773 unfinished Todos through the real Daemon", () => {
const browserFor = (session: string) => (...args: string[]) => promisify(execFile)("agent-browser", ["--session", session, ...args], { timeout: 60_000 });

let one: StartedDaemon;

let two: StartedDaemon;

beforeAll(async () => {
  one = await startRealDaemon({}, true);
  two = await startRealDaemon({});
}, 240_000);

afterAll(async () => { await two?.stop(); await one?.stop(); });

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const mount = async (real: StartedDaemon, draftsFor = createProjectDrafts()) => {
  const app = createServedApp(real.base);
  const calls: string[] = [];
  const rpc = app.rpc;

  app.rpc = (method, params) => { calls.push(method);

 return rpc(method, params); };

  const connected = await connectProject(app, { name: "same Project", path: real.dir }, () => true, () => 0,
    () => null, undefined, draftsFor(real.dir));

  await showEverything(connected);

  const rendered = render(() => <ConnectedProjectContext.Provider value={connected}>
    <Todos /><DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
  </ConnectedProjectContext.Provider>);

  await waitFor(() => expect(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);

  return { ...rendered, connected, app, calls };
};

const openBody = async (id: number, body: string) => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^Idle #${id} `) }));
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  await within(drawer).findByRole("region", { name: "Todo history" });
  await waitFor(() => expect(drawer.querySelector("[data-change]")).not.toBeNull());
  fireEvent.dblClick(within(drawer).getByText(body));

  return within(drawer).getByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
};

it("u2773a_todos_restores_exact_work_across_real_projects_and_reload", async () => {
  const firstApp = createServedApp(one.base);
  const secondApp = createServedApp(two.base);
  const first = await firstApp.rpc("todo.create", { title: "same Todo", body: "base one", blockers: null });

  await secondApp.rpc("todo.create", { title: "other identity", body: null, blockers: null });
  const second = await secondApp.rpc("todo.create", { title: "same Todo", body: "base two", blockers: null });
  const owners = createProjectDrafts();
  const a = await mount(one, owners);
  const field = await openBody(first.id, "base one");
  const exact = "  e\u0301 🧪\noriginal Project  ";

  fireEvent.input(field, { target: { value: exact } });
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  a.unmount();
  const b = await mount(two, owners);
  const other = await openBody(second.id, "base two");

  expect(other.value).toBe("base two");
  fireEvent.input(other, { target: { value: "  second Project\n独立  " } });
  b.unmount();
  // A fresh authority reads disk, as a fresh webview does; it does not reuse the previous editor or memory.
  const restored = await mount(one);
  const recovered = await openBody(first.id, "base one");

  await waitFor(() => expect(recovered.selectionStart).toBe(2));
  expect([recovered.value, recovered.selectionStart, recovered.selectionEnd, recovered.selectionDirection]).toEqual([exact, 2, 5, "backward"]);
  expect(restored.calls.filter(method => method === "todo.update" || method === "todo.create" || method === "todo.setBlockers")).toEqual([]);
  expect((await firstApp.rpc("todo.get", { id: first.id })).body).toBe("base one");
  expect((await secondApp.rpc("todo.get", { id: second.id })).body).toBe("base two");
}, 60_000);

it("u2773c_todos_external_change_keeps_original_at_real_daemon", async () => {
  const external = createServedApp(one.base);
  const original = await external.rpc("todo.create", { title: "conflict target", body: "original base", blockers: null });
  const { connected, app } = await mount(one);
  const field = await openBody(original.id, "original base");

  fireEvent.input(field, { target: { value: "  my edit\n🧪  " } });
  const captured = connected.drafts.list().find(draft => draft.destination.object === String(original.id))!;

  await external.rpc("todo.update", { id: original.id, title: null, body: "another Actor" });
  await screen.findByText(/Changed Todo/);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect((await app.rpc("todo.get", { id: original.id })).body).toBe("another Actor");
  expect(connected.drafts.list().find(draft => draft.status === "failed")?.value).toEqual(captured.value);
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveProperty("value", "  my edit\n🧪  ");
}, 60_000);

it("u2773c_todos_unavailable_original_keeps_project_local_recovery", async () => {
  const external = createServedApp(two.base);
  const original = await external.rpc("todo.create", { title: "removed original", body: "base to remove", blockers: null });
  const { connected, app } = await mount(two);
  const field = await openBody(original.id, "base to remove");

  fireEvent.input(field, { target: { value: "  recover after removal 🧪  " } });
  connected.drawer.close("key");
  await external.rpc("todo.delete", { id: original.id });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(String(original.id)));
  expect(connected.drafts.list().find(draft => draft.destination.object === String(original.id))?.value.text).toBe("  recover after removal 🧪  ");
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  expect(connected.drafts.list()).toEqual([]);
  expect((await app.rpc("todo.list", null)).some(todo => todo.id === original.id)).toBe(false);
}, 60_000);

it("u2773a_todos_creation_restores_original_project_without_delivery", async () => {
  const a = await mount(one);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "  creation e\u0301 🧪  " } });
  field.setSelectionRange(1, 4, "backward");
  fireEvent.select(field);
  a.unmount();
  const b = await mount(two);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "");
  b.unmount();
  const restored = await mount(one);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const recovered = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  expect([recovered.value, recovered.selectionStart, recovered.selectionEnd, recovered.selectionDirection]).toEqual(["  creation e\u0301 🧪  ", 1, 4, "backward"]);
  expect(restored.calls.filter(method => method === "todo.create")).toEqual([]);
}, 60_000);

it("u2773e_todos_failed_retention_survives_real_project_reopen", async () => {
  const owners = createProjectDrafts();
  const a = await mount(one, owners);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const field = screen.getByRole("textbox", { name: "New Todo title" });
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });

  fireEvent.input(field, { target: { value: "  in memory after close 🧪  " } });
  a.unmount();
  writes.mockRestore();
  const reopened = await mount(one, owners);

  expect(screen.getByRole("alert").textContent).toContain(one.dir);
  fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "  in memory after close 🧪  ");
  expect(reopened.connected.drafts.problem()).toBeNull();
  expect(reopened.calls.filter(method => method === "todo.create")).toEqual([]);
}, 60_000);


it("u2773a_todos_real_browser_reload_restores_without_creation", async () => {
  const session = `u2773-todos-${crypto.randomUUID()}`;
  const browser = browserFor(session);
  const app = createServedApp(one.base);
  const before = await app.rpc("todo.list", null);

  try {
    await browser("open", `${one.base}/harness.html?daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("wait", "[aria-label='Add Todo']");
    await browser("click", "[aria-label='Add Todo']");
    await browser("eval", `(() => {
      const field = document.querySelector('[aria-label="New Todo title"]');
      field.value = "  e\u0301 🧪 browser draft  ";
      field.dispatchEvent(new Event("input", {bubbles: true}));
      field.setSelectionRange(2, 5, "backward");
      field.dispatchEvent(new Event("select", {bubbles: true}));
    })()`);
    await browser("reload");
    await browser("wait", "[aria-label='Add Todo']");
    const background = await browser("eval", `JSON.stringify({field: Boolean(document.querySelector('[aria-label="New Todo title"]')), focus: document.activeElement?.getAttribute("aria-label")})`);

    expect(JSON.parse(JSON.parse(background.stdout))).toMatchObject({ field: false });
    await browser("click", "[aria-label='Add Todo']");

    const recovered = await browser("eval", `JSON.stringify((() => {
      const field = document.querySelector('[aria-label="New Todo title"]');
      return [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection];
    })())`);

    // The CLI prints JSON string results as JSON strings; parse that transport wrapper, then the observed form.
    expect(JSON.parse(JSON.parse(recovered.stdout))).toEqual(["  e\u0301 🧪 browser draft  ", 2, 5, "backward"]);
    expect(await app.rpc("todo.list", null)).toEqual(before);
  } finally { await browser("close"); }
}, 120_000);

it("u2773b_todos_acknowledgement_consumes_only_submitted_revision_once", async () => {
  const external = createServedApp(two.base);
  const original = await external.rpc("todo.create", { title: "acknowledgement target", body: "before acceptance", blockers: null });
  const { app, connected } = await mount(two);
  const rpc = app.rpc;
  let release: (() => void) | undefined;

  app.rpc = async (method, params) => {
    const result = await rpc(method, params);

    if (method === "todo.update") await new Promise<void>(resolve => { release = resolve; });

    return result;
  };

  const field = await openBody(original.id, "before acceptance");

  fireEvent.input(field, { target: { value: "  accepted A 🧪  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(release).toBeTypeOf("function"));
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  await within(drawer).findByText("accepted A 🧪", { exact: true });

  fireEvent.dblClick(within(drawer).getByText("accepted A 🧪", { exact: true }));
  const newer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Body" });

  fireEvent.input(newer, { target: { value: "  unsent B\nnewer  " } });
  release?.();
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(connected.drafts.list().map(draft => draft.value.text)).toEqual(["  unsent B\nnewer  "]);
  expect(newer.value).toBe("  unsent B\nnewer  ");
  const history = await external.rpc("todo.getHistory", { id: original.id });

  expect(history.changes.filter(change => change.after.body === "  accepted A 🧪  ")).toHaveLength(1);
}, 60_000);


it("u2773b_todos_browser_discards_hidden_revision_without_delivery", async () => {
  const browser = browserFor(`u2773-discard-${crypto.randomUUID()}`);
  const app = createServedApp(one.base);
  const original = await app.rpc("todo.create", { title: "discard by pointer", body: "keep this base", blockers: null });

  try {
    await browser("open", `${one.base}/harness.html?daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("wait", '[data-shelf-group="unassigned"] [data-part="branch-control"]');
    await browser("click", '[data-shelf-group="unassigned"] [data-part="branch-control"]');
    await browser("click", `[aria-label="Idle #${original.id} discard by pointer"]`);
    await browser("wait", ".drawer [data-change]");
    await browser("dblclick", ".todo-detail-body p");
    await browser("fill", '[aria-label="Body"]', "  discard editor 🧪  ");
    await browser("eval", `document.querySelector('.drawer [aria-label="Body"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await browser("click", ".drawer .todo-draft-actions button:last-child");
    const recovered = await browser("eval", `JSON.stringify({field: Boolean(document.querySelector('.drawer [aria-label="Body"]')), drafts: JSON.parse(localStorage.getItem(${JSON.stringify(`roundup:drafts:${one.dir}`)})).drafts.length})`);

    expect(JSON.parse(JSON.parse(recovered.stdout))).toEqual({ field: false, drafts: 0 });
    expect((await app.rpc("todo.get", { id: original.id })).body).toBe("keep this base");
  } finally { await browser("close"); }
}, 120_000);

});
