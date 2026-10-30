import { copy as recoveryCopy } from "../sharedCopy";
import { todo } from "../todos/testHarness";
import { createNow, DisplayClockContext } from "../state/clock";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createFakeApp } from "./fakeApp";
import { todoHandlers } from "./stores";
import type { TodoStore } from "./stores";
import { event } from "./nodes";
import { RpcError } from "../app/seam";
import { connectProject, ConnectedProjectContext, createProjectDrafts } from "../state/connectedProject";
import { showEverything } from "./showEverything";
import { DrawerHost } from "../drawer/DrawerHost";
import { Todos } from "../todos/Todos";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("u2773 unfinished Todos through the App seam", () => {

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const mount = async (original: ReturnType<typeof todo>) => {
  const app = createFakeApp();
  const store: TodoStore = { todos: [original], changes: new Map(), reads: new Map() };
  Object.assign(app.handlers, todoHandlers(store, data => app.emit(event(data))));
  // The captured history is input to the App; storage concurrency belongs to the Rust module tests.
  store.changes!.set(original.id, [{ seq: 1, before: null, after: {
    title: original.title, body: original.body, done: false, blockers: [], owner: null, priority: null,
  }, actor: original.creator, changed_at: 0 }]);

  const connected = await connectProject(app, { name: "same Project", path: "/todo-drafts" }, () => true, () => 0,
    () => null, undefined, createProjectDrafts()("/todo-drafts"));

  await showEverything(connected);

  const rendered = render(() => {
    const now = createNow(() => 0, () => false);

    return <DisplayClockContext.Provider value={now.subscribe}><ConnectedProjectContext.Provider value={connected}>
    <Todos /><DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
  </ConnectedProjectContext.Provider></DisplayClockContext.Provider>;
  });

  await waitFor(() => expect(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);

  return { ...rendered, connected, app, store };
};

const openBody = async (id: number, body: string) => {
  const focusedRow = await screen.findByRole("button", { name: new RegExp(`^Idle #${id} `) });
  focusedRow.focus();
  fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" });
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  await within(drawer).findByRole("button", { name: /^Changes/ });
  fireEvent.dblClick(await within(drawer).findByText(body));

  return within(drawer).findByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
};

it("u2773c_todos_external_change_keeps_original", async () => {
  const original = todo(1, { title: "conflict target", body: "original base" });
  const { connected, app, store } = await mount(original);
  const field = await openBody(original.id, "original base");

  fireEvent.input(field, { target: { value: "  my edit\n🧪  " } });
  const captured = connected.drafts.list().find(draft => draft.destination.object === String(original.id))!;

  const changed = { ...original, body: "another Actor" };
  store.todos = [changed];
  store.changes!.set(original.id, [...store.changes!.get(original.id)!, { seq: 2, before: store.changes!.get(original.id)![0]!.after,
    after: { title: changed.title, body: changed.body, done: false, blockers: [], owner: null, priority: null }, actor: original.creator, changed_at: 1 }]);
  app.handlers["todo.update"] = () => { throw new RpcError(-32003, "Todo changed since editing began"); };
  app.emit(event({ name: "todo.updated", data: changed }));

  await screen.findByText(/Changed Todo/);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect(app.calls.filter(call => call.method === "todo.update")).toEqual([{
    method: "todo.update", params: { id: original.id, title: null, body: "  my edit\n🧪  ", expected_change: 1 },
  }]);
  expect(captured.destination).toMatchObject({ object: String(original.id), recipient: "body" });
  expect(captured.value).toMatchObject({ base: "original base", expected_change: 1 });
  expect(connected.drafts.list().find(draft => draft.status === "failed")?.value).toEqual(captured.value);
  expect(await screen.findByRole("textbox", { name: "Body" })).toHaveProperty("value", "  my edit\n🧪  ");
}, 60_000);

it("u2773c_todos_unavailable_original_keeps_project_local_recovery", async () => {
  const original = todo(1, { title: "removed original", body: "base to remove" });
  const { connected, app, store } = await mount(original);
  const field = await openBody(original.id, "base to remove");

  fireEvent.input(field, { target: { value: "  recover after removal 🧪  " } });
  connected.drawer.close("key");
  store.todos = [];
  app.emit(event({ name: "todo.deleted", data: { id: original.id } }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(String(original.id)));
  expect(connected.drafts.list().find(draft => draft.destination.object === String(original.id))?.value.text).toBe("  recover after removal 🧪  ");
  fireEvent.click(screen.getByRole("button", { name: recoveryCopy.discardRevision }));
  expect(connected.drafts.list()).toEqual([]);
  expect(app.calls.filter(call => ["todo.create", "todo.update", "todo.delete"].includes(call.method))).toEqual([]);
}, 60_000);

});
