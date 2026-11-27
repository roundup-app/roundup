import { ToastHost } from "./toastHost";
import { todo } from "../todos/testHarness";
import { createNow, DisplayClockContext } from "../state/clock";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
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

    return <DisplayClockContext value={now.subscribe}><ToastHost><ConnectedProjectContext value={connected}>
    <Todos /><DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
  </ConnectedProjectContext></ToastHost></DisplayClockContext>;
  });

  await waitFor(() => expect(document.querySelector('[data-shelf-group="unassigned"] .shelf-group-control')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] .shelf-group-control')!);

  return { ...rendered, connected, app, store };
};

const openBody = async (id: number, body: string) => {
  const focusedRow = await screen.findByRole("button", { name: new RegExp(`^Idle #${id} `) });
  focusedRow.focus();
  fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" });
  flush();
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  const activity = await within(drawer).findByRole("region", { name: "Activity" });
  fireEvent.click(await within(activity).findByRole("button", { name: "1 change" }));
  await within(activity).findByText(/^Created /);
  fireEvent.dblClick(await within(drawer).findByText(body));

  return within(drawer).findByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
};

it("u2773c_todos_external_change_keeps_original", async () => {
  const original = todo(1, { title: "conflict target", body: "original base" });
  const { connected, app, store } = await mount(original);
  const field = await openBody(original.id, "original base");
  // The body saves as it is typed (U7641a), so the Daemon already refuses the first save.
  app.handlers["todo.update"] = () => { throw new RpcError(-32003, "Todo changed since editing began"); };

  fireEvent.input(field, { target: { value: "  my edit\n🧪  " } });
  flush();
  const captured = connected.drafts.list().find(draft => draft.destination.object === String(original.id))!;

  const changed = { ...original, body: "another Actor" };
  store.todos = [changed];
  store.changes!.set(original.id, [...store.changes!.get(original.id)!, { seq: 2, before: store.changes!.get(original.id)![0]!.after,
    after: { title: changed.title, body: changed.body, done: false, blockers: [], owner: null, priority: null }, actor: original.creator, changed_at: 1 }]);

  app.emit(event({ name: "todo.updated", data: changed }));

  await screen.findByText(/Changed Todo/);
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect(app.calls.filter(call => call.method === "todo.update")).toEqual([{
    method: "todo.update", params: { id: original.id, title: null, body: "  my edit\n🧪  ", expected_change: 1 },
  }]);
  expect(captured.destination).toMatchObject({ object: String(original.id), recipient: "body" });
  expect(captured.value).toMatchObject({ base: "original base", expected_change: 1 });
  expect(connected.drafts.list().find(draft => draft.status === "failed")?.value).toEqual(captured.value);
  expect(await screen.findByRole("textbox", { name: "Body" })).toHaveProperty("value", "  my edit\n🧪  ");
}, 60_000);


});
