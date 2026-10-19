import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountTodos, todo } from "./testHarness";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("u2773a_todos_restores_exact_work_after_hiding_creation", async () => {
  const { app } = await mountTodos([]);
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const text = "  e\u0301 🧪 unfinished  ";
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: text } });
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));
  const restored = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([text, 2, 5, "backward"]);
  expect(app.calls.filter(call => call.method === "todo.create")).toEqual([]);
});

it("u2773c_todos_external_change_keeps_original_blocker_base", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2)]);
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.readHistory")).toBe(true));
  fireEvent.click(screen.getByText("Blocker"));
  app.handlers["todo.setBlockers"] = () => Promise.reject(new RpcError(-32003, "conflict"));
  fireEvent.click(within(screen.getByRole("complementary", { name: "Drawer" })).getByRole("button", { name: /#2/ }));
  await screen.findByText("conflict");
  expect(app.calls.find(call => call.method === "todo.setBlockers")?.params).toEqual({ id: 1, blockers: [2], expected_change: 1 });
  expect(connected.drafts.list().find(draft => draft.destination.recipient?.startsWith("blockers:"))?.value).toMatchObject({ blockers: ["2"], expected_change: 1 });
});

it("u2773a_todos_restores_exact_work_after_hiding_body", async () => {
  const { app, connected } = await mountTodos([todo(1, { body: "base" })]);
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.readHistory")).toBe(true));
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
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
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
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.readHistory")).toBe(true));
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
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const field = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "  refused A  " } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByText("Failed");
  fireEvent.input(field, { target: { value: "  newer B 🧪  " } });
  fireEvent.click(within(screen.getByText("Failed").parentElement!).getByRole("button", { name: "Discard this revision" }));
  const path = connected.project.path;

  unmount();
  const restored = await mountTodos([], true, [], false, path);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "  newer B 🧪  ");
  expect(restored.connected.drafts.list().map(draft => draft.value.title)).toEqual(["  newer B 🧪  "]);
  expect(restored.app.calls.filter(call => call.method === "todo.create")).toEqual([]);
});

it("u2773e_todos_recovery_actions_keep_surface_draft", async () => {
  const { connected, app } = await mountTodos([]);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
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
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.readHistory")).toBe(true));
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
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const first = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(first, { target: { value: "  original Project A  " } });
  fireEvent.keyDown(first, { key: "Enter" });
  original.unmount();
  const other = await mountTodos([]);

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
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

  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  fireEvent.input(screen.getByRole("textbox", { name: "New Todo title" }), { target: { value: "discard this" } });
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));
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
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.readHistory")).toBe(true));
  fireEvent.click(screen.getByText("Blocker"));
  fireEvent.click(within(screen.getByRole("complementary", { name: "Drawer" })).getByRole("button", { name: /#2/ }));
  await screen.findByText("conflict");
  fireEvent.click(screen.getByRole("button", { name: "Copy Todo" }));
  expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual({ title: "todo 1", body: "", done: false, blockers: ["2"], baseBlockers: [], expected_change: 1,
    originalTitle: "todo 1", originalBody: "", originalDone: false, originalBlockers: [], originalChange: 1, action: "add", blocker: 2 });
});

it("u2773a_todos_blocker_choice_survives_a_failed_incoming_history_read", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2)]);

  fireEvent.click(await screen.findByRole("button", { name: /#1 / }));
  await waitFor(() => expect(app.calls.some(call => call.method === "todo.readHistory")).toBe(true));
  let reject: ((error: Error) => void) | undefined;

  app.handlers["todo.getHistory"] = () => new Promise((_resolve, fail) => { reject = fail; });
  fireEvent.click(screen.getByText("Blocker"));
  fireEvent.click(within(screen.getByRole("complementary", { name: "Drawer" })).getByRole("button", { name: /#2/ }));
  expect(connected.drafts.list().map(draft => draft.value.blockers)).toEqual([["2"]]);
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  reject?.(new RpcError(-32003, "history unavailable"));
  await screen.findByText("history unavailable");
  expect(connected.drafts.list()[0]?.value).toMatchObject({ blockers: ["2"], originalChange: 1, originalBlockers: [] });
  expect(app.calls.filter(call => call.method === "todo.setBlockers")).toEqual([]);
});

it("u2773a_todos_repeated_add_keeps_the_original_home_after_selection_changes", async () => {
  const { app, connected } = await mountTodos([], true, [workstream("a"), workstream("b")]);

  connected.rail.select("a");
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const field = screen.getByRole("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "  original Home A 🧪  " } });
  connected.rail.select("b");
  fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const restored = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([exact, 2, 5, "backward"]);
});
