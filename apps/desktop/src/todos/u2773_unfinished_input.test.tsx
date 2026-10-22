import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { Todos } from "./Todos";
import { ConnectedProjectContext } from "../state/connectedProject";
import { TodoDrawer } from "./TodoDrawer";
import { mountTodos, todo } from "./testHarness";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("u2773a_todos_restores_exact_work_after_hiding_creation", async () => {
  const { app } = await mountTodos([]);
  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const text = "  e\u0301 🧪 unfinished  ";
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: "first keystrokes" } });
  fireEvent.input(field, { target: { value: text } });
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toBe(field);
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  const restored = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([text, 2, 5, "backward"]);
  expect(app.calls.filter(call => call.method === "todo.create")).toEqual([]);
});

it("u2773c_todos_external_change_keeps_original_blocker_base", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2)]);
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.getHistory")).toBe(true));
  fireEvent.click(screen.getByText("Blocker"));
  app.handlers["todo.setBlockers"] = () => Promise.reject(new RpcError(-32003, "conflict"));
  fireEvent.click(await screen.findByRole("option", { name: /#2/ }));
  await screen.findByText("conflict");
  expect(app.calls.find(call => call.method === "todo.setBlockers")?.params).toEqual({ id: 1, blockers: [2], expected_change: 1 });
  expect(connected.drafts.list().find(draft => draft.destination.recipient?.startsWith("blockers:"))?.value).toMatchObject({ blockers: ["2"], expected_change: 1 });
});

it("u2773a_todos_restores_exact_work_after_hiding_body", async () => {
  const { app, connected } = await mountTodos([todo(1, { body: "base" })]);
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.getHistory")).toBe(true));
  fireEvent.dblClick(within(screen.getByRole("complementary", { name: "Drawer" })).getByText("base"));
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
  const text = "  e\u0301 🧪\nnext line  ";
  fireEvent.input(field, { target: { value: text } });
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  connected.drawer.close("key");
  fireEvent.click(screen.getByRole("button", { name: /#1 / }));
  fireEvent.dblClick(within(screen.getByRole("complementary", { name: "Drawer" })).getByText("base"));
  const restored = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
  await waitFor(() => expect(restored.selectionStart).toBe(2));
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([text, 2, 5, "backward"]);
  fireEvent.blur(restored);
  expect(app.calls.filter(call => call.method === "todo.update")).toEqual([]);
});

it.each(["failed", "unknown", "acknowledged"] as const)("u2773b_todos_settlement_preserves_other_revisions_%s", async outcome => {
  const { app, connected } = await mountTodos([]);
  let acknowledge: ((value: ReturnType<typeof todo>) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  app.handlers["todo.create"] = () => new Promise((resolve, fail) => { acknowledge = resolve; reject = fail; });
  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: "  A 🧪  " } });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.input(field, { target: { value: "  newer B  " } });

  if (outcome === "acknowledged") acknowledge?.(todo(1));
  else reject?.(outcome === "failed" ? new RpcError(-32003, "refused") : new Error("connection lost"));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(field.value).toBe("  newer B  ");
  expect(connected.drafts.list().map(draft => [draft.value.title, draft.status])).toEqual(outcome === "acknowledged"
    ? [["  newer B  ", "draft"]] : [["  A 🧪  ", outcome], ["  newer B  ", "draft"]]);
  expect(app.calls.filter(call => call.method === "todo.create")).toHaveLength(1);
});

it.each(["failed", "unknown", "acknowledged"] as const)("u2773b_todos_detail_settlement_preserves_other_revisions_%s", async outcome => {
  const { app, connected } = await mountTodos([todo(1, { body: "base" })]);
  let acknowledge: ((value: ReturnType<typeof todo>) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;

  app.handlers["todo.update"] = () => new Promise((resolve, fail) => { acknowledge = resolve; reject = fail; });
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.getHistory")).toBe(true));
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  fireEvent.dblClick(within(drawer).getByText("base"));
  fireEvent.input(screen.getByRole("textbox", { name: "Body" }), { target: { value: "  A\n🧪  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.dblClick(within(drawer).getByText("base"));
  const newer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Body" });

  fireEvent.input(newer, { target: { value: "  B\nnewer  " } });

  if (outcome === "acknowledged") acknowledge?.(todo(1));
  else reject?.(outcome === "failed" ? new RpcError(-32003, "refused") : new Error("connection lost"));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(newer.value).toBe("  B\nnewer  ");
  expect(connected.drafts.list().map(draft => [draft.value.text, draft.status])).toEqual(outcome === "acknowledged"
    ? [["  B\nnewer  ", "draft"]] : [["  A\n🧪  ", outcome], ["  B\nnewer  ", "draft"]]);
  expect(app.calls.filter(call => call.method === "todo.update")).toHaveLength(1);
});

it("u2773b_todos_discard_removes_only_selected_revision_across_reopen", async () => {
  const { app, connected, unmount } = await mountTodos([]);

  app.handlers["todo.create"] = () => Promise.reject(new RpcError(-32003, "refused"));
  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const field = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "  refused A  " } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByText("Failed");
  fireEvent.input(field, { target: { value: "  newer B 🧪  " } });
  fireEvent.click(within(screen.getByRole("region", { name: "Todo · new" })).getByRole("button", { name: "Discard this revision" }));
  const path = connected.project.path;

  unmount();
  const restored = await mountTodos([], true, [], false, path);

  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "  newer B 🧪  ");
  expect(restored.connected.drafts.list().map(draft => draft.value.title)).toEqual(["  newer B 🧪  "]);
  expect(restored.app.calls.filter(call => call.method === "todo.create")).toEqual([]);
});

it("u2773e_todos_recovery_actions_keep_surface_draft", async () => {
  const { connected, app } = await mountTodos([]);

  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  const stored = localStorage.getItem(`roundup:drafts:${connected.project.path}`);
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  const writeText = vi.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fireEvent.input(field, { target: { value: "  exact 🧪  " } });
  expect(screen.getByRole("alert").textContent).toContain(connected.project.path);
  fireEvent.click(screen.getByRole("button", { name: "Copy Todo" }));
  expect(writeText).toHaveBeenCalledWith("  exact 🧪  ");
  expect(localStorage.getItem(`roundup:drafts:${connected.project.path}`)).toBe(stored);
  writes.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
  expect(connected.drafts.problem()).toBeNull();
  expect(field.value).toBe("  exact 🧪  ");
  expect(JSON.parse(localStorage.getItem(`roundup:drafts:${connected.project.path}`)!).drafts[0].value.title).toBe("  exact 🧪  ");
  expect(app.calls.filter(call => call.method === "todo.create")).toEqual([]);
});

it("u2773a_todos_title_survives_escape_without_submission", async () => {
  const { app } = await mountTodos([todo(1, { title: "original" })]);

  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.getHistory")).toBe(true));
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  fireEvent.dblClick(within(drawer).getByText("original"));
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Title" });

  fireEvent.input(field, { target: { value: "  title e\u0301 🧪  " } });
  field.setSelectionRange(1, 5, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.dblClick(within(drawer).getByText("original"));
  const recovered = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Title" });

  await waitFor(() => expect(recovered.selectionStart).toBe(1));
  expect([recovered.value, recovered.selectionStart, recovered.selectionEnd, recovered.selectionDirection]).toEqual(["  title e\u0301 🧪  ", 1, 5, "backward"]);
  expect(app.calls.filter(call => call.method === "todo.update")).toEqual([]);
});

it("u2773b_todos_late_failure_settles_original_project_only", async () => {
  const original = await mountTodos([]);
  let reject: ((error: Error) => void) | undefined;

  original.app.handlers["todo.create"] = () => new Promise((_resolve, fail) => { reject = fail; });
  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const first = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(first, { target: { value: "  original Project A  " } });
  fireEvent.keyDown(first, { key: "Enter" });
  original.unmount();
  const other = await mountTodos([]);

  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const newer = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  fireEvent.input(newer, { target: { value: "  different Project B 🧪  " } });
  reject?.(new RpcError(-32003, "original refused"));
  await waitFor(() => expect(original.connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect(newer.value).toBe("  different Project B 🧪  ");
  expect(other.connected.drafts.list().map(draft => draft.value.title)).toEqual(["  different Project B 🧪  "]);
  expect(original.connected.drafts.list().find(draft => draft.status === "failed")?.value.title).toBe("  original Project A  ");
});

it("u2773b_todos_discard_current_does_not_restore_it_on_escape", async () => {
  const { connected } = await mountTodos([]);

  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  fireEvent.input(screen.getByRole("textbox", { name: "New Todo title" }), { target: { value: "discard this" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "New Todo title" }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  const reopened = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  expect(reopened.value).toBe("");
  expect(connected.drafts.list()).toEqual([]);
});

it("u2773e_todos_blocker_recovery_copies_complete_form", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  const writeText = vi.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  app.handlers["todo.setBlockers"] = () => Promise.reject(new RpcError(-32003, "conflict"));
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.getHistory")).toBe(true));
  fireEvent.click(screen.getByText("Blocker"));
  fireEvent.click(await screen.findByRole("option", { name: /#2/ }));
  await screen.findByText("conflict");
  fireEvent.click(screen.getByRole("button", { name: "Copy Todo" }));
  expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual({ title: "todo 1", body: "", done: false, blockers: ["2"], baseBlockers: [], expected_change: 1,
    home: null, originalTitle: "todo 1", originalBody: "", originalDone: false, originalBlockers: [], originalChange: 1, action: "add", blocker: 2 });
});

it("u2773a_todos_blocker_choice_survives_a_failed_incoming_history_read", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2)]);

  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.getHistory")).toBe(true));
  let reject: ((error: Error) => void) | undefined;

  app.handlers["todo.getHistory"] = () => new Promise((_resolve, fail) => { reject = fail; });
  fireEvent.click(screen.getByText("Blocker"));
  fireEvent.click(await screen.findByRole("option", { name: /#2/ }));
  await waitFor(() => expect(connected.drafts.list().map(draft => draft.value.blockers)).toEqual([["2"]]));
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  reject?.(new RpcError(-32003, "history unavailable"));
  await screen.findByText("history unavailable");
  expect(connected.drafts.list()[0]?.value).toMatchObject({ blockers: ["2"], originalChange: 1, originalBlockers: [] });
  expect(app.calls.filter(call => call.method === "todo.setBlockers")).toEqual([]);
});

it("u2773a_todos_repeated_add_keeps_the_original_home_after_selection_changes", async () => {
  const { app, connected } = await mountTodos([], true, [workstream("a"), workstream("b")]);

  connected.rail.select("a");
  fireEvent.click(await screen.findByRole("button", { name: /add todo to/ }));
  const field = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "  original Home A 🧪  " } });
  connected.rail.select("b");
  fireEvent.click(screen.getByRole("button", { name: /add todo to/ }));
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.move")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "todo.move")?.params).toEqual({ id: 1, home: "a" });
});

it("u2773e_todos_incompatible_form_keeps_original_bytes_and_newer_work", async () => {
  const path = "/todo-incompatible-form";
  const key = `roundup:drafts:${path}`;
  const invalid = { revision: "incompatible", destination: { surface: "todos", object: "42", recipient: "title" }, value: { title: false }, selection: null, status: "draft", policy: "ordinary" };
  const independent = { ...invalid, revision: "independent", destination: { surface: "orders", object: "original", recipient: null }, value: { ask: "  independent 🧪  " } };
  const bytes = JSON.stringify({ version: 1, drafts: [invalid, independent] }, null, 2);

  localStorage.setItem(key, bytes);
  const { connected, app, unmount } = await mountTodos([], true, [], false, path);

  expect(connected.drafts.problem()).toMatchObject({ project: path, destination: invalid.destination, operation: "restore", cause: "invalid" });
  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  const exact = "  new e\u0301 🧪 memory  ";

  fireEvent.input(field, { target: { value: exact } });
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  const recovery = within(screen.getByRole("region", { name: "Todo · new" }));
  const writeText = vi.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fireEvent.click(recovery.getByRole("button", { name: "Copy Todo" }));
  expect(writeText).toHaveBeenCalledWith(exact);
  fireEvent.click(recovery.getByRole("button", { name: "Retry storage only" }));
  fireEvent.click(within(await screen.findByRole("region", { name: "Todo · 42" })).getByRole("button", { name: "Discard this revision" }));
  expect(localStorage.getItem(key)).toBe(bytes);
  expect(field.value).toBe(exact);
  expect(connected.drafts.list().find(draft => draft.revision === "independent")).toEqual(independent);
  localStorage.setItem(key, JSON.stringify({ version: 1, drafts: [independent] }));
  fireEvent.click(recovery.getByRole("button", { name: "Retry storage only" }));
  expect(connected.drafts.problem()).toBeNull();
  expect(app.calls.filter(call => call.method === "todo.create" || call.method === "todo.update")).toEqual([]);
  unmount();
  await mountTodos([], true, [], false, path);
  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const restored = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([exact, 2, 5, "backward"]);
});

it("u2773a_todos_live_creation_enters_recovery_only_after_hiding", async () => {
  await mountTodos([]);
  fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));
  const field = screen.getByRole("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: "unfinished" } });
  expect(screen.queryByRole("button", { name: "Copy Todo" })).toBeNull();
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Copy Todo", description: /Title.*unfinished/ })).toBeTruthy();
});

it("u2773b_todos_failed_title_reopens_without_duplicating_revision", async () => {
  const { app, connected } = await mountTodos([todo(1, { title: "original" })]);
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.getHistory")).toBe(true));
  fireEvent.dblClick(within(screen.getByRole("complementary", { name: "Drawer" })).getByText("original"));
  fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "refused title" } });
  expect(screen.queryByRole("button", { name: "Copy Todo" })).toBeNull();
  app.handlers["todo.update"] = () => Promise.reject(new RpcError(-32003, "refused"));
  document.activeElement instanceof HTMLElement && document.activeElement.blur();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  field.setSelectionRange(2, 3, "backward");
  fireEvent.select(field);
  expect(connected.drafts.list().map(draft => [draft.status, draft.selection])).toEqual([["failed", { start: 2, end: 3, direction: "backward" }]]);
  expect(screen.getByRole("button", { name: "Copy Todo", description: /Failed.*Title.*refused title/ })).toBeTruthy();
});


it.each([
  ["title", "failed"], ["title", "unknown"], ["body", "failed"], ["body", "unknown"],
] as const)("u3021c_open_restores_exact_revision_without_rpc_todo_%s_%s", async (name, outcome) => {
  const { app, connected, todos } = await mountTodos([todo(1, { title: "original", body: "base" })]);
  const destination = { surface: "todos", object: "1", recipient: name };
  const text = name === "body" ? "  e\u0301 🧪\n次の行  " : "  title e\u0301 🧪  ";

  const form = { text, base: name === "title" ? "original" : "base", expected_change: 1,
    title: "original", body: "base", done: false, blockers: [] };

  const selection = { start: 2, end: 5, direction: "backward" as const };
  const a = connected.drafts.edit(destination, form, selection, "ordinary").draft;
  connected.drafts.submit(a.revision);
  connected.drafts.settle(a.revision, outcome);
  const b = connected.drafts.edit(destination, { ...form, text: "newer B" }, selection, "ordinary").draft;
  const before = connected.drafts.list();
  const calls = [...app.calls];

  const open = (revision: string) => connected.drawer.open(() => <TodoDrawer id={1} todos={todos}
    recovery={{ project: connected.project.path, revision }} />, "key");

  open(a.revision);
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: name === "title" ? "Title" : "Body" });
  await waitFor(() => expect(field.selectionDirection).toBe("backward"));
  expect([field.value, field.selectionStart, field.selectionEnd]).toEqual([text, 2, 5]);
  field.focus(); fireEvent.blur(field);
  connected.drawer.close("key");
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  open(b.revision);
  expect(await screen.findByRole("textbox", { name: name === "title" ? "Title" : "Body" })).toHaveProperty("value", "newer B");
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});


it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_todo_creation_%s", async outcome => {
  const { app, connected, todos } = await mountTodos([], true, [workstream("a"), workstream("b")]);
  const destination = { surface: "todos", object: "new", recipient: "a" };
  const selection = { start: 2, end: 5, direction: "backward" as const };
  const a = connected.drafts.edit(destination, { title: "  e\u0301 🧪 title  ", home: "a" }, selection, "ordinary").draft;
  connected.drafts.submit(a.revision); connected.drafts.settle(a.revision, outcome);
  connected.drafts.edit(destination, { title: "newer B", home: "a" }, selection, "ordinary");
  await waitFor(() => expect(todos.isLoaded()).toBe(true));
  connected.rail.select("b");
  const before = connected.drafts.list();
  const calls = [...app.calls];

  const opened = render(() => <ConnectedProjectContext.Provider value={connected}>
    <Todos recovery={{ project: connected.project.path, revision: a.revision, list: todos }} />
  </ConnectedProjectContext.Provider>);

  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect([field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual(["  e\u0301 🧪 title  ", 2, 5, "backward"]);
  fireEvent.blur(field); fireEvent.keyDown(field, { key: "Escape" });
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  opened.unmount();

  const changedSelection = { start: 7, end: 12, direction: "forward" as const };

  const reopen = () => render(() => <ConnectedProjectContext.Provider value={connected}>
    <Todos recovery={{ project: connected.project.path, revision: a.revision, list: todos }} />
  </ConnectedProjectContext.Provider>);

  const selected = reopen();
  const selectedField = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  await waitFor(() => expect(document.activeElement).toBe(selectedField));
  selectedField.setSelectionRange(7, 12, "forward");
  fireEvent.select(selectedField);
  fireEvent.keyDown(selectedField, { key: "Escape" });
  selected.unmount();
  const restored = reopen();
  const restoredField = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  await waitFor(() => expect(document.activeElement).toBe(restoredField));
  expect([restoredField.selectionStart, restoredField.selectionEnd, restoredField.selectionDirection]).toEqual([7, 12, "forward"]);
  expect(connected.drafts.list()).toEqual(before.map(draft => draft.revision === a.revision ? { ...draft, selection: changedSelection } : draft));
  expect(app.calls).toEqual(calls);
  restored.unmount();
});

it("u3021c_todo_creation_discard_from_another_control_closes_the_selected_editor", async () => {
  const { app, connected, todos } = await mountTodos([]);
  await waitFor(() => expect(todos.isLoaded()).toBe(true));
  const destination = { surface: "todos", object: "new", recipient: null };
  const a = connected.drafts.edit(destination, { title: "discard A", home: null }, null, "ordinary").draft;
  connected.drafts.submit(a.revision);
  connected.drafts.settle(a.revision, "failed");
  const b = connected.drafts.edit(destination, { title: "keep B", home: null }, null, "ordinary").draft;
  const calls = [...app.calls];

  const opened = render(() => <ConnectedProjectContext.Provider value={connected}>
    <Todos recovery={{ project: connected.project.path, revision: a.revision, list: todos }} />
  </ConnectedProjectContext.Provider>);

  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  // The Shelf's recovery control is mounted separately from the recovered creation editor.
  fireEvent.click(screen.getAllByRole("button", { name: "Discard this revision", description: /discard A/ })[0]!);
  expect(screen.queryByRole("textbox", { name: "New Todo title" })).toBeNull();
  fireEvent.keyDown(field, { key: "Escape" });
  opened.unmount();
  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "keep B");
  expect(connected.drafts.list()).toEqual([b]);
  expect(app.calls).toEqual(calls);
});


it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_todo_blockers_%s", async outcome => {
  const { app, connected, todos } = await mountTodos([todo(1), todo(2)]);
  const destination = { surface: "todos", object: "1", recipient: "blockers:original" };

  const form = { title: "  captured 🧪  ", body: "  e\u0301\n次の行  ", done: false, blockers: ["2"], baseBlockers: [], expected_change: 1,
    originalTitle: "todo 1", originalBody: "", originalDone: false, originalBlockers: [], originalChange: 1, action: "add", blocker: 2 };

  const a = connected.drafts.edit(destination, form, null, "ordinary").draft;
  connected.drafts.submit(a.revision); connected.drafts.settle(a.revision, outcome);
  connected.drafts.edit(destination, { ...form, blockers: [] }, null, "ordinary");
  const before = connected.drafts.list();
  const calls = [...app.calls];
  connected.drawer.open(() => <TodoDrawer id={1} todos={todos} recovery={{ project: connected.project.path, revision: a.revision }} />, "key");
  const drawer = within(await screen.findByRole("complementary", { name: "Drawer" }));
  expect((await drawer.findByText("captured 🧪")).textContent).toBe("  captured 🧪  ");
  expect(drawer.getByText("e\u0301 次の行").textContent).toBe("  e\u0301\n次の行  ");
  expect(drawer.getByRole("button", { name: "Remove blocker #2" })).toBeTruthy();
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  fireEvent.click(drawer.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.revision === a.revision)).toBe(outcome === "unknown"));
  expect(app.calls.slice(calls.length)).toEqual(outcome === "unknown" ? [] : [{ method: "todo.setBlockers", params: { id: 1, blockers: [2], expected_change: 1 } }]);
  expect(connected.drafts.list().at(-1)?.value.blockers).toEqual([]);
});


it.each(["failed", "unknown", "acknowledged"] as const)("u3021c_todo_selected_save_uses_captured_change_%s", async outcome => {
  const { app, connected, todos } = await mountTodos([todo(1, { body: "changed elsewhere" })]);
  const destination = { surface: "todos", object: "1", recipient: "body" };
  const form = { text: "  A 🧪\n次の行  ", base: "old base", expected_change: 7, title: "todo 1", body: "old base", done: false, blockers: [] };
  const a = connected.drafts.edit(destination, form, null, "ordinary").draft;
  connected.drafts.submit(a.revision); connected.drafts.settle(a.revision, outcome === "acknowledged" ? "failed" : outcome);
  const b = connected.drafts.edit(destination, { ...form, text: "newer B" }, null, "ordinary").draft;
  app.handlers["todo.update"] = () => outcome === "acknowledged" ? todo(1, { body: form.text }) : Promise.reject(new RpcError(-32003, "captured conflict"));
  connected.drawer.open(() => <TodoDrawer id={1} todos={todos} recovery={{ project: connected.project.path, revision: a.revision }} />, "key");
  await screen.findByRole("textbox", { name: "Body" });
  const calls = [...app.calls];
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  if (outcome === "failed") await screen.findByText("captured conflict");
  expect(app.calls.slice(calls.length)).toEqual(outcome === "unknown" ? [] : [{ method: "todo.update", params: { id: 1, title: null, body: form.text, expected_change: 7 } }]);

  if (outcome === "acknowledged") await waitFor(() => expect(connected.drafts.list()).toEqual([b]));
  else expect(connected.drafts.list()).toEqual([{ ...a, status: outcome }, b]);
});

it.each(["failed", "unknown"] as const)("u3021c_todo_selected_creation_save_keeps_captured_home_%s", async outcome => {
  const { app, connected, todos } = await mountTodos([], true, [workstream("a"), workstream("b")]);
  await waitFor(() => expect(todos.isLoaded()).toBe(true));
  const destination = { surface: "todos", object: "new", recipient: "a" };
  const a = connected.drafts.edit(destination, { title: "  authored 🧪  ", home: "a" }, null, "ordinary").draft;
  connected.drafts.submit(a.revision); connected.drafts.settle(a.revision, outcome);
  const b = connected.drafts.edit(destination, { title: "newer B", home: "a" }, null, "ordinary").draft;
  connected.rail.select("b");
  const calls = [...app.calls];
  render(() => <ConnectedProjectContext.Provider value={connected}><Todos recovery={{ project: connected.project.path, revision: a.revision, list: todos }} /></ConnectedProjectContext.Provider>);
  const field = screen.getByRole("textbox", { name: "New Todo title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });

  if (outcome === "failed") await waitFor(() => expect(app.calls.some(call => call.method === "todo.move")).toBe(true));

  if (outcome === "unknown") expect(field).toHaveProperty("value", "  authored 🧪  ");
  expect(app.calls.slice(calls.length)).toEqual(outcome === "unknown" ? [] : [
    { method: "todo.create", params: { title: "authored 🧪", body: null, blockers: null } },
    { method: "todo.move", params: { id: 1, home: "a" } },
  ]);
  expect(connected.drafts.list()).toEqual(outcome === "unknown" ? [{ ...a, status: outcome }, b] : [b]);
});

it.each(["project", "facts-project", "object", "home", "removed"] as const)("u3021c_todo_selected_revision_refuses_wrong_%s", async mismatch => {
  const { app, connected, todos } = await mountTodos(mismatch === "removed" ? [todo(2)] : [todo(1), todo(2)]);

  const a = connected.drafts.edit({ surface: "todos", object: mismatch === "object" ? "2" : "1", recipient: "body" },
    { text: "never retarget", base: "", home: mismatch === "home" ? "gone-home" : null, expected_change: 1, title: "todo 1", body: "", done: false, blockers: [] }, null, "ordinary").draft;

  const calls = [...app.calls];
  connected.drawer.open(() => <TodoDrawer id={1} todos={mismatch === "facts-project" ? { ...todos, project: "/other-project" } : todos}
    recovery={{ project: mismatch === "project" ? "/other-project" : connected.project.path, revision: a.revision }} />, "key");
  await waitFor(() => expect(screen.getByRole("complementary", { name: "Drawer" }).getAttribute("data-settling")).toBe("false"));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(app.calls).toEqual(calls);
  expect(connected.drafts.list()).toEqual([a]);
});

it.each(["project", "facts-project", "object", "home", "removed"] as const)("u3021c_todo_creation_refuses_wrong_%s", async mismatch => {
  const { app, connected, todos } = await mountTodos([], true, [workstream("a"), workstream("b")]);
  await waitFor(() => expect(todos.isLoaded()).toBe(true));

  const a = connected.drafts.edit({ surface: "todos", object: mismatch === "object" ? "1" : "new", recipient: mismatch === "removed" ? "gone-home" : "a" },
    { title: "never retarget", home: mismatch === "home" ? "b" : mismatch === "removed" ? "gone-home" : "a" }, null, "ordinary").draft;

  const calls = [...app.calls];
  render(() => <ConnectedProjectContext.Provider value={connected}><Todos recovery={{ project: mismatch === "project" ? "/other-project" : connected.project.path, revision: a.revision, list: mismatch === "facts-project" ? { ...todos, project: "/other-project" } : todos }} /></ConnectedProjectContext.Provider>);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(app.calls).toEqual(calls);
  expect(connected.drafts.list()).toEqual([a]);
});
