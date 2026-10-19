import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { connectProject, ConnectedProjectContext, createProjectDrafts } from "../state/connectedProject";
import { showEverything } from "../testing/showEverything";
import { DrawerHost } from "../drawer/DrawerHost";
import { Todos } from "./Todos";

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
  await screen.findByText(/was deleted/);
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


it("u2773b_todos_browser_discard_closes_current_editor_without_delivery", async () => {
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
    await browser("click", ".drawer .todo-draft-actions button:last-child");
    const recovered = await browser("eval", `JSON.stringify({field: Boolean(document.querySelector('.drawer [aria-label="Body"]')), drafts: JSON.parse(localStorage.getItem(${JSON.stringify(`roundup:drafts:${one.dir}`)})).drafts.length})`);

    expect(JSON.parse(JSON.parse(recovered.stdout))).toEqual({ field: false, drafts: 0 });
    expect((await app.rpc("todo.get", { id: original.id })).body).toBe("keep this base");
  } finally { await browser("close"); }
}, 120_000);
