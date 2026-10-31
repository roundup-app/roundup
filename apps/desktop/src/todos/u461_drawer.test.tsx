import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { TodoDrawer } from "./TodoDrawer";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

stubDialogLayout();

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async () => {
  const mounted = await mountTodos([todo(1, { title: "Ship", body: "Read this\nThen this" })]);
  { const row = await screen.findByRole("button", { name: "Idle #1 Ship" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  await within(panel()).findByRole("button", { name: /^Blocked by/ });

  return mounted;
};

it("u461_completion_failure_keeps_focus", async () => {
  const { app } = await open();
  app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32003, "Try again"));
  const box = within(panel()).getByRole<HTMLInputElement>("checkbox", { name: "Complete Ship" });
  box.focus(); fireEvent.click(box);
  await within(panel()).findByText("Try again");
  expect(box.checked).toBe(false); expect(document.activeElement).toBe(box);
});

it("u461_completion_success_keeps_drawer_focus", async () => {
  const { app, store } = await open();
  const box = within(panel()).getByRole<HTMLInputElement>("checkbox", { name: "Complete Ship" });
  box.focus(); fireEvent.click(box);
  await waitFor(() => expect(todoCallsTo(app, "todo.complete")).toHaveLength(1));
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await waitFor(() => expect((box).checked).toBe(true));
  expect(panel().contains(document.activeElement)).toBe(true);
});

it("u461_delete_failure_is_retryable", async () => {
  const { app, connected } = await open();
  let reject!: (error: RpcError) => void;
  app.handlers["todo.delete"] = () => new Promise((_, fail) => { reject = fail; });

  fireEvent.click(within(panel()).getByRole("button", { name: "More actions" }));

  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  fireEvent.click(within(panel()).getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));

  expect(todoCallsTo(app, "todo.delete")).toHaveLength(1);
  reject(new RpcError(-32003, "Delete failed"));
  await screen.findByText("Delete failed");
  app.handlers["todo.delete"] = (params) => ({ operation: params.operation, deleted: params.ids, missing: [], state: "deleted" });
  fireEvent.click(within(panel()).getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));

  await waitFor(() => expect(connected.drawer.content()).toBeNull());
  expect(todoCallsTo(app, "todo.delete")).toHaveLength(2);
});

it("u461_pad_drawer_keeps_its_touch_line", async () => {
  const { openShelf, openPad, padOf } = await import("../pads/padsFixture");
  const { USER } = await import("../testing/nodes");
  const { state } = await openShelf([padOf("Notes", USER, "Read me")]);
  state.history = [{ actor: USER, verb: "wrote", item: "pad:Notes", at: new Date(2026, 0, 5, 14, 22).getTime() }];

  await openPad("Notes");

  expect(await screen.findByText(/You wrote · /)).toBeTruthy();
});

const doneSurface = async (surface: "fold" | "drawer" | "agent", input: "pointer" | "space") => {
  const creator = { kind: "agent", id: "a", parent: null } as const;
  const initial = todo(1, { done: true });

  if (surface === "agent") initial.creator = creator;

  const mounted = await mountTodos([initial], true,
    surface === "agent" ? [agent("a", "idle", "ready")] : []);

  if (surface === "agent") mounted.connected.rail.select("a");

  fireEvent.click(await screen.findByRole("button", { name: "1 done" }));

  if (surface === "drawer") { const row = await screen.findByRole("button", { name: "Done #1 todo 1" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const area = surface === "drawer" ? panel() : document.querySelector<HTMLElement>(".shelf")!;
  const box = await within(area).findByRole<HTMLInputElement>("checkbox", { name: "Reopen todo 1" });
  box.focus();

  const activate = () => {
    if (input === "pointer") { fireEvent.click(box);

 return; }

    const allowed = fireEvent.keyDown(box, { key: " ", code: "Space", bubbles: true });
    fireEvent.keyUp(box, { key: " ", code: "Space", bubbles: true });

    // jsdom omits the native click: dispatch it only if the App allowed Space's default action.
    if (allowed) fireEvent.click(box);
  };

  return { mounted, area, box, activate };
};

for (const surface of ["fold", "drawer", "agent"] as const) {
  for (const input of ["pointer", "space"] as const) {
    it(`u461a_each_surface_reopens_by_pointer_and_space ${surface} ${input}`, async () => {
      const { mounted, box, activate } = await doneSurface(surface, input);
      const before = mounted.app.calls.length;
      activate();
      await waitFor(() => expect(mounted.app.calls.slice(before).filter(c => ["todo.reopen", "todo.complete", "todo.delete", "todo.move"].includes(c.method))).toEqual([{ method: "todo.reopen", params: { id: 1 } }]));
      expect(Boolean(mounted.connected.drawer.content())).toBe(surface === "drawer");
      mounted.app.emit(todoEvent("todo.updated", mounted.store.todos[0]!));

      if (surface === "drawer") {
        await waitFor(() => expect(box.checked).toBe(false));
        expect(document.activeElement).toBe(box);
      } else {
        await waitFor(() => expect(box.isConnected).toBe(false));
      }
    });

    it(`u461a_pending_and_failure_preserve_accepted_value ${surface} ${input}`, async () => {
      const { mounted, area, box, activate } = await doneSurface(surface, input);
      const reopen = mounted.app.handlers["todo.reopen"]!;
      let reject!: (error: RpcError) => void;
      mounted.app.handlers["todo.reopen"] = () => new Promise((_, fail) => { reject = fail; });
      activate(); activate();
      expect(box.checked).toBe(true);
      await waitFor(() => expect(todoCallsTo(mounted.app, "todo.reopen").map(call => call.params)).toEqual([{id:1}]));
      reject(new RpcError(-32003, "Cannot reopen yet"));
      await within(area).findByText("Cannot reopen yet");
      expect(box.checked).toBe(true);
      expect(document.activeElement).toBe(box);
      mounted.app.handlers["todo.reopen"] = reopen;
      activate();
      await waitFor(() => expect(todoCallsTo(mounted.app, "todo.reopen").map(call => call.params)).toEqual([{id:1},{id:1}]));
      await waitFor(() => expect(within(area).queryByRole("alert")).toBeNull());
    });
  }
}

for (const { remaining, reopened, target } of [
  { remaining: [1, 2, 3], reopened: 1, target: /Done #2 / },
  { remaining: [1, 2, 3], reopened: 3, target: /Done #2 / },
  { remaining: [1], reopened: 1, target: "Add Todo: Overview" },
]) {
  it(`u461a_success_refetches_surfaces_and_keeps_focus in the done fold ${reopened} ${remaining}`, async () => {
    const mounted = await mountTodos(remaining.map(id => todo(id, { done: true })));

    fireEvent.click(await screen.findByRole("button", { name: `${remaining.length} done` }));
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: `Reopen todo ${reopened}` });
    box.focus(); fireEvent.click(box);
    await waitFor(() => expect(todoCallsTo(mounted.app, "todo.reopen").map(call => call.params)).toEqual([{id:reopened}]));
    mounted.app.emit(todoEvent("todo.updated", mounted.store.todos.find(t => t.id === reopened)!));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: target })));
    // The reopened Todo is Unassigned, a group that starts folded.
    fireEvent.click(await screen.findByText("Unassigned"));
    expect(await screen.findByRole("checkbox", { name: `Complete todo ${reopened}` })).toBeTruthy();
  });
}

it("u461a_success_refetches_surfaces_and_keeps_focus_in_the_drawer", async () => {
  const mounted = await mountTodos([todo(1, { done: true }), todo(2, { blockers: [1] }), todo(3)]);
  fireEvent.click(await screen.findByText("Unassigned"));
  { const row = await screen.findByRole("button", { name: "Done #1 todo 1" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const box = await within(panel()).findByRole<HTMLInputElement>("checkbox", { name: "Reopen todo 1" });
  box.focus(); fireEvent.click(box);
  await waitFor(() => expect(todoCallsTo(mounted.app, "todo.reopen").map(call => call.params)).toEqual([{id:1}]));
  mounted.app.emit(todoEvent("todo.updated", mounted.store.todos[0]!));
  await within(document.body).findByRole("button", { name: "Blocked #2 todo 2" });
  expect(box.checked).toBe(false);
  expect(document.activeElement).toBe(box);
  expect(mounted.connected.drawer.content()).not.toBeNull();
  const rows = [...document.querySelectorAll<HTMLElement>(".shelf [data-todo]")];
  expect(rows.map(row => Number(row.dataset.todo))).toEqual([1, 2, 3]);
  expect(rows[1]!.getAttribute("aria-level")).toBe("2");
  expect(within(rows[1]!).getByRole("button", { name: "Blocked #2 todo 2" }).closest("[role=treeitem]")?.getAttribute("aria-level")).toBe("2");

});

it("u461a_recovery_drawer_reopens_accepted_state_and_preserves_the_retained_form", async () => {
  const { app, connected, todos, store } = await mountTodos([todo(1)]);
  const destination = { surface: "todos", object: "1", recipient: "blockers:original" };

  const form = { title: "Retained title", body: "Retained body", done: false, blockers: [], baseBlockers: [], expected_change: 1,
    originalTitle: "todo 1", originalBody: "", originalDone: false, originalBlockers: [], originalChange: 1, action: "add", blocker: 2 };

  const retained = connected.drafts.edit(destination, form, null, "ordinary").draft;
  connected.drafts.submit(retained.revision); connected.drafts.settle(retained.revision, "failed");
  await app.rpc("todo.complete", { id: 1 });
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await screen.findByRole("button", { name: "1 done" });
  const drafts = connected.drafts.list();
  const calls = [...app.calls];
  connected.drawer.open(() => <TodoDrawer id={1} todos={todos} recovery={{ project: connected.project.path, revision: retained.revision }} />, "key");
  const box = await within(panel()).findByRole<HTMLInputElement>("checkbox", { name: "Reopen todo 1" });
  expect(box.checked).toBe(true);
  expect(app.calls).toEqual(calls);
  box.focus(); fireEvent.click(box);
  await waitFor(() => expect(todoCallsTo(app, "todo.reopen")).toHaveLength(1));
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await waitFor(() => expect(box.checked).toBe(false));
  expect(document.activeElement).toBe(box);
  expect(connected.drafts.list()).toEqual(drafts);
});
