import { flush } from "solid-js";
import { copy as recoveryCopy } from "../sharedCopy";
import { notice } from "../testing/notices";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { Todos } from "./Todos";
import { ConnectedProjectContext } from "../state/connectedProject";
import { TodoDrawer } from "./TodoDrawer";
import { historyLoaded, mountTodos, titleClosed, todo, todoCallsTo } from "./testHarness";
import { ToastHost } from "../testing/toastHost";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("u2773a_todos_restores_exact_work_after_hiding_creation", async () => {
  const { app } = await mountTodos([]);
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo: Overview" }));
  const text = "  e\u0301 🧪 unfinished  ";
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: "first keystrokes" } });
  fireEvent.input(field, { target: { value: text } });
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toBe(field);
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Add Todo: Overview" }));
  const restored = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([text, 2, 5, "backward"]);
  expect(app.calls.filter(call => call.method === "todo.create" || call.method === "todo.comment")).toEqual([]);
});

it("u2773c_todos_external_change_keeps_original_blocker_base", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2)]);
  { const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  await screen.findByRole("region", { name: "Activity" });
  fireEvent.click(screen.getByRole("button", { name: /^Blocked by/ }));
  app.handlers["todo.setBlockers"] = () => Promise.reject(new RpcError(-32003, "conflict"));
  fireEvent.click(await screen.findByRole("option", { name: /#2/ }));
  await screen.findByText("conflict");
  expect(app.calls.find(call => call.method === "todo.setBlockers")?.params).toEqual({ id: 1, blockers: [2], expected_change: 1 });
  expect(connected.drafts.list().find(draft => draft.destination.recipient?.startsWith("blockers:"))?.value).toMatchObject({ blockers: ["2"], expected_change: 1 });
});

it("u2773a_todos_restores_exact_work_after_hiding_body", async () => {
  const { app, connected } = await mountTodos([todo(1, { body: "base" })]);
  { const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  await screen.findByRole("region", { name: "Activity" });
  fireEvent.dblClick(await within(screen.getByRole("complementary", { name: "Drawer" })).findByText("base"));
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  const text = "  e\u0301 🧪\nnext line  ";
  fireEvent.input(field, { target: { value: text } });
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  connected.drawer.close("key");
  { const row = screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  fireEvent.dblClick(await within(screen.getByRole("complementary", { name: "Drawer" })).findByText("base"));
  const restored = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
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
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo: Overview" }));
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: "  A 🧪  " } });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.input(field, { target: { value: "  newer B  " } });

  await waitFor(() => expect(acknowledge).toBeTypeOf("function"));

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
  { const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  await screen.findByRole("region", { name: "Activity" });
  await historyLoaded(app);
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  fireEvent.dblClick(await within(drawer).findByText("base"));
  const first = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
  await waitFor(() => expect(document.activeElement).toBe(first));
  fireEvent.input(first, { target: { value: "  A\n🧪  " } });
  // A body saves once the typing pauses; B is typed while that save is in flight.
  await waitFor(() => expect(acknowledge).toBeTypeOf("function"), { timeout: 3000 });
  const newer = first;

  fireEvent.input(newer, { target: { value: "  B\nnewer  " } });

  if (outcome === "acknowledged") acknowledge?.(todo(1));
  else reject?.(outcome === "failed" ? new RpcError(-32003, "refused") : new Error("connection lost"));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(newer.value).toBe("  B\nnewer  ");
  expect(connected.drafts.list().map(draft => [draft.value.text, draft.status])).toEqual(outcome === "acknowledged"
    ? [["  B\nnewer  ", "draft"]] : [["  A\n🧪  ", outcome], ["  B\nnewer  ", "draft"]]);
  expect(app.calls.filter(call => call.method === "todo.update")).toHaveLength(1);
});

it("u2773a_todos_title_survives_escape_without_submission", async () => {
  const { app } = await mountTodos([todo(1, { title: "original" })]);

  { const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  await screen.findByRole("region", { name: "Activity" });
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  fireEvent.dblClick(within(drawer).getByText("original", { selector: ":not(.todo-breadcrumb-title)" }));
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });

  fireEvent.input(field, { target: { value: "  title e\u0301 🧪  " } });
  field.setSelectionRange(1, 5, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  await titleClosed(field);
  fireEvent.dblClick(within(drawer).getByText("original", { selector: ":not(.todo-breadcrumb-title)" }));
  const recovered = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });

  await waitFor(() => expect(recovered.selectionStart).toBe(1));
  expect([recovered.value, recovered.selectionStart, recovered.selectionEnd, recovered.selectionDirection]).toEqual(["  title e\u0301 🧪  ", 1, 5, "backward"]);
  expect(app.calls.filter(call => call.method === "todo.update")).toEqual([]);
});

it("u2773b_todos_late_failure_settles_original_project_only", async () => {
  const original = await mountTodos([]);
  let reject: ((error: Error) => void) | undefined;

  original.app.handlers["todo.create"] = () => new Promise((_resolve, fail) => { reject = fail; });
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo: Overview" }));
  const first = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(first, { target: { value: "  original Project A  " } });
  fireEvent.keyDown(first, { key: "Enter" });
  original.unmount();
  const other = await mountTodos([]);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo: Overview" }));
  const newer = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  fireEvent.input(newer, { target: { value: "  different Project B 🧪  " } });
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  reject?.(new RpcError(-32003, "original refused"));
  await waitFor(() => expect(original.connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect(newer.value).toBe("  different Project B 🧪  ");
  expect(other.connected.drafts.list().map(draft => draft.value.title)).toEqual(["  different Project B 🧪  "]);
  expect(original.connected.drafts.list().find(draft => draft.status === "failed")?.value.title).toBe("  original Project A  ");
});

it("u2773a_todos_blocker_choice_survives_a_failed_incoming_history_read", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2)]);

  { const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  await screen.findByRole("region", { name: "Activity" });
  await historyLoaded(app);
  const rejections: ((error: Error) => void)[] = [];

  app.handlers["todo.getHistory"] = () => new Promise((_resolve, fail) => { rejections.push(fail); });
  fireEvent.click(screen.getByRole("button", { name: /^Blocked by/ }));
  fireEvent.click(await screen.findByRole("option", { name: /#2/ }));
  await waitFor(() => expect(connected.drafts.list().map(draft => draft.value.blockers)).toEqual([["2"]]));

  // U6249b: the read is tried 5 times before it fails.
  for (let attempt = 1; attempt <= 5; attempt++) {
    await waitFor(() => expect(rejections).toHaveLength(attempt));
    rejections[attempt - 1]?.(new RpcError(-32003, attempt === 5 ? "history unavailable" : "first history failure"));
  }

  await screen.findByText("history unavailable");
  expect(connected.drafts.list()[0]?.value).toMatchObject({ blockers: ["2"], originalChange: 1, originalBlockers: [] });
  expect(app.calls.filter(call => call.method === "todo.setBlockers")).toEqual([]);
});

it("u2773a_todos_repeated_add_keeps_the_original_home_after_selection_changes", async () => {
  const { app, connected } = await mountTodos([], true, [workstream("a"), workstream("b")]);

  connected.rail.select("a");
  fireEvent.click(await screen.findByRole("button", { name: /add todo:/i }));
  const field = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "  original Home A 🧪  " } });
  connected.rail.select("b");
  fireEvent.click(screen.getByRole("button", { name: /add todo:/i }));
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.move")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "todo.move")?.params).toEqual({ id: 1, home: "a" });
});

it("u2773b_todos_failed_title_reopens_without_duplicating_revision", async () => {
  const { app, connected } = await mountTodos([todo(1, { title: "original" })]);
  { const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  await screen.findByRole("region", { name: "Activity" });
  fireEvent.click(await screen.findByRole("button", { name: "1 change" }));
  await waitFor(() => expect(todoCallsTo(app, "todo.readHistory")).toHaveLength(1));
  fireEvent.dblClick(within(screen.getByRole("complementary", { name: "Drawer" })).getByText("original", { selector: ":not(.todo-breadcrumb-title)" }));
  fireEvent.input(await screen.findByRole("textbox", { name: "Title" }), { target: { value: "refused title" } });
  app.handlers["todo.update"] = () => Promise.reject(new RpcError(-32003, "refused"));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), { key: "Enter" });
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  field.setSelectionRange(2, 3, "backward");
  fireEvent.select(field);
  expect(connected.drafts.list().map(draft => [draft.status, draft.selection])).toEqual([["failed", { start: 2, end: 3, direction: "backward" }]]);
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
  await connected.drafts.submit(a.revision);
  await connected.drafts.settle(a.revision, outcome);
  const b = connected.drafts.edit(destination, { ...form, text: "newer B" }, selection, "ordinary").draft;
  flush();
  const before = connected.drafts.list();
  const calls = [...app.calls];

  const open = (revision: string) => connected.drawer.open(() => <TodoDrawer id={1} todos={todos}
    recovery={{ project: connected.project.path, revision }} />, "key");

  open(a.revision);
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: name === "title" ? "Title" : "Body" });
  await waitFor(() => expect(field.selectionDirection).toBe("backward"));
  expect([field.value, field.selectionStart, field.selectionEnd]).toEqual([text, 2, 5]);
  field.focus(); fireEvent.blur(field);
  flush();
  connected.drawer.close("key");
  flush();
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  open(b.revision);
  expect(await screen.findByRole("textbox", { name: name === "title" ? "Title" : "Body" })).toHaveProperty("value", "newer B");
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});


it("u3021c_todo_title_enter_on_an_unknown_revision_keeps_the_field_and_its_text", async () => {
  const { app, connected, todos } = await mountTodos([todo(1, { title: "original", body: "base" })]);
  const destination = { surface: "todos", object: "1", recipient: "title" };
  const form = { text: "  title e\u0301 🧪  ", base: "original", expected_change: 1, title: "original", body: "base", done: false, blockers: [] };
  const a = connected.drafts.edit(destination, form, null, "ordinary").draft;
  await connected.drafts.submit(a.revision);
  await connected.drafts.settle(a.revision, "unknown");
  const calls = [...app.calls];
  connected.drawer.open(() => <TodoDrawer id={1} todos={todos} recovery={{ project: connected.project.path, revision: a.revision }} />, "key");
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByRole("alert", { name: recoveryCopy.draftStatus.unknown });
  expect(field.style.visibility).not.toBe("hidden");
  expect(field.value).toBe(form.text);
  expect(app.calls.slice(calls.length)).toEqual([]);
});

it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_todo_creation_%s", async outcome => {
  const { app, connected, todos } = await mountTodos([], true, [workstream("a"), workstream("b")]);
  const destination = { surface: "todos", object: "new", recipient: "a" };
  const selection = { start: 2, end: 5, direction: "backward" as const };
  const a = connected.drafts.edit(destination, { title: "  e\u0301 🧪 title  ", home: "a" }, selection, "ordinary").draft;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, outcome);
  connected.drafts.edit(destination, { title: "newer B", home: "a" }, selection, "ordinary");
  await waitFor(() => expect(todos.isLoaded()).toBe(true));
  connected.rail.select("b");
  const before = connected.drafts.list();
  const calls = [...app.calls];

  const opened = render(() => <ToastHost><ConnectedProjectContext value={connected}>
    <Todos recovery={{ project: connected.project.path, revision: a.revision, list: todos }} />
  </ConnectedProjectContext></ToastHost>);

  flush();

  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect([field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual(["  e\u0301 🧪 title  ", 2, 5, "backward"]);
  fireEvent.blur(field); fireEvent.keyDown(field, { key: "Escape" });
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  opened.unmount();

  const changedSelection = { start: 7, end: 12, direction: "forward" as const };

  const reopen = () => render(() => <ToastHost><ConnectedProjectContext value={connected}>
    <Todos recovery={{ project: connected.project.path, revision: a.revision, list: todos }} />
  </ConnectedProjectContext></ToastHost>);

  flush();

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

it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_todo_blockers_%s", async outcome => {
  const { app, connected, todos } = await mountTodos([todo(1), todo(2)]);
  const destination = { surface: "todos", object: "1", recipient: "blockers:original" };

  const form = { title: "  captured 🧪  ", body: "  e\u0301\n次の行  ", done: false, blockers: ["2"], baseBlockers: [], expected_change: 1,
    originalTitle: "todo 1", originalBody: "", originalDone: false, originalBlockers: [], originalChange: 1, action: "add", blocker: 2 };

  const a = connected.drafts.edit(destination, form, null, "ordinary").draft;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, outcome);
  connected.drafts.edit(destination, { ...form, blockers: [] }, null, "ordinary");
  flush();
  const before = connected.drafts.list();
  const calls = [...app.calls];
  connected.drawer.open(() => <TodoDrawer id={1} todos={todos} recovery={{ project: connected.project.path, revision: a.revision }} />, "key");
  const drawer = within(await screen.findByRole("complementary", { name: "Drawer" }));
  expect((await drawer.findByText(form.title.trim(), { selector: "p" })).textContent).toBe(form.title);
  expect(drawer.getByText(form.body.replaceAll("\n", " ").trim()).textContent).toBe(form.body);
  fireEvent.click(drawer.getByRole("button", { name: /^Blocked by/ }));
  expect(await screen.findByRole("option", { name: /#2/ })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
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
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, outcome === "acknowledged" ? "failed" : outcome);
  const b = connected.drafts.edit(destination, { ...form, text: "newer B" }, null, "ordinary").draft;
  app.handlers["todo.update"] = () => outcome === "acknowledged" ? todo(1, { body: form.text }) : Promise.reject(new RpcError(-32003, "captured conflict"));
  connected.drawer.open(() => <TodoDrawer id={1} todos={todos} recovery={{ project: connected.project.path, revision: a.revision }} />, "key");
  const field = await screen.findByRole("textbox", { name: "Body" });
  const calls = [...app.calls];
  const updates = () => app.calls.slice(calls.length).filter(call => call.method === "todo.update");
  fireEvent.input(field, { target: { value: form.text } });

  if (outcome === "failed") await screen.findByText("captured conflict");

  if (outcome === "acknowledged") await waitFor(() => expect(updates()).toHaveLength(1));
  expect(updates()).toEqual(outcome === "unknown" ? [] : [{ method: "todo.update", params: { id: 1, title: null, body: form.text, expected_change: 7 } }]);

  if (outcome === "acknowledged") await waitFor(() => expect(connected.drafts.list()).toEqual([b]));
  else expect(connected.drafts.list()).toEqual([{ ...a, status: outcome }, b]);
});

it.each(["failed", "unknown"] as const)("u3021c_todo_selected_creation_save_keeps_captured_home_%s", async outcome => {
  const { app, connected, todos } = await mountTodos([], true, [workstream("a"), workstream("b")]);
  await waitFor(() => expect(todos.isLoaded()).toBe(true));
  const destination = { surface: "todos", object: "new", recipient: "a" };
  const a = connected.drafts.edit(destination, { title: "  authored 🧪  ", home: "a" }, null, "ordinary").draft;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, outcome);
  const b = connected.drafts.edit(destination, { title: "newer B", home: "a" }, null, "ordinary").draft;
  connected.rail.select("b");
  const calls = [...app.calls];
  render(() => <ToastHost><ConnectedProjectContext value={connected}><Todos recovery={{ project: connected.project.path, revision: a.revision, list: todos }} /></ConnectedProjectContext></ToastHost>);
  flush();
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
  render(() => <ToastHost><ConnectedProjectContext value={connected}><Todos recovery={{ project: mismatch === "project" ? "/other-project" : connected.project.path, revision: a.revision, list: mismatch === "facts-project" ? { ...todos, project: "/other-project" } : todos }} /></ConnectedProjectContext></ToastHost>);
  flush();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(app.calls).toEqual(calls);
  expect(connected.drafts.list()).toEqual([a]);
});

it.each(["acknowledged", "failed"] as const)("u4698e_composer_keeps_existing_send_and_draft_contract_%s", async outcome => {
  const open = async () => {
    const row = await screen.findByRole("button", { name: /^Idle #1 / }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
    await screen.findByRole("textbox", { name: "Write a comment" });
  };

  const path = `/activity-draft/${crypto.randomUUID()}`;
  const m = await mountTodos([todo(1)], true, [], false, path);
  await open();
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  let resolve!: (value: import("@contracts/todo/Comment").Comment) => void;
  let reject!: (error: Error) => void;
  m.app.handlers["todo.comment"] = () => new Promise((yes, no) => { resolve = yes; reject = no; });
  const a = "  A é\n雪 😀  "; const b = " B newer\n日本語 ";
  fireEvent.input(field, { target: { value: a } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.comment")).toHaveLength(1));
  fireEvent.input(field, { target: { value: b } });

  if (outcome === "failed") reject(new RpcError(-32003, "Cannot send A"));
  else resolve({ id: 99, body: a, created_at: 0, read: true, author: { kind: "user", id: "you", parent: null } });
  await waitFor(() => expect(m.connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(field.value).toBe(b);
  expect(m.connected.drafts.list().filter(draft => draft.destination.recipient === "comment").map(draft => draft.value.text)).toEqual(outcome === "failed" ? [a, b] : [b]);
  m.unmount();
  const other = await mountTodos([todo(1)], true, [], false, path + "/other"); await open();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" }).value).toBe("");
  other.unmount();
  const restored = await mountTodos([todo(1)], true, [], false, path); await open();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" }).value).toBe(b);
  expect(todoCallsTo(restored.app, "todo.comment")).toHaveLength(0);
});

it("u7978b_typed_text_returns_in_its_own_field_todo", async () => {
  const { app } = await mountTodos([]);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo: Overview" }));
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: "  typed, not sent 🧪  " } });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(field.isConnected).toBe(false));

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo: Overview" }));
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "  typed, not sent 🧪  ");
  expect(app.calls.filter(call => call.method === "todo.create")).toEqual([]);
  expect(screen.queryByText(/unfinished work/i)).toBeNull();
});
