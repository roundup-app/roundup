import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { History } from "@contracts/todo/History";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async (mounted: Awaited<ReturnType<typeof mountTodos>>, id = 1) => {
  const before = todoCallsTo(mounted.app, "todo.readHistory").length;
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^Idle #${id} `) }));
  await within(panel()).findByRole("region", { name: "Todo history" });
  await waitFor(() => expect(todoCallsTo(mounted.app, "todo.readHistory").length).toBeGreaterThan(before));
};

it("u462_only_the_open_drawer_requests_history", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  expect(todoCallsTo(m.app, "todo.getHistory")).toHaveLength(0);
  await open(m);
  expect(todoCallsTo(m.app, "todo.getHistory").map((call) => call.params)).toEqual([{ id: 1 }]);
  expect(todoCallsTo(m.app, "todo.get")).toHaveLength(0);
});

it("u462_first_read_marks_all_available_entries", async () => {
  const m = await mountTodos([todo(1)]); await open(m);
  const rule = within(panel()).getByRole("separator", { name: "Unread changes" });
  expect(rule.nextElementSibling?.getAttribute("data-change")).toBe("1");
});

it("u462_reopening_uses_existing_touches", async () => {
  const m = await mountTodos([todo(1)]); await open(m); m.connected.drawer.close();
  await m.app.rpc("todo.update", { id: 1, title: null, body: "Later" });
  await open(m);
  expect(within(panel()).getByRole("separator", { name: "Unread changes" }).nextElementSibling?.textContent).toBe("Body: Later");
});

it("u462_no_unread_changes_has_no_rule", async () => {
  const m = await mountTodos([todo(1)]); await m.app.rpc("todo.get", { id: 1 }); await open(m);
  expect(within(panel()).queryByRole("separator")).toBeNull();
});

it.each([false, true])("u462_live_history_keeps_edit_and_focus_previous_read_%s", async (prior) => {
  const m = await mountTodos([todo(1)]);

  if (prior) await m.app.rpc("todo.get", { id: 1 });
  await open(m);
  fireEvent.dblClick(within(panel()).getByText("todo 1"));
  const field = await within(panel()).findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });
  fireEvent.input(field, { target: { value: "My unfinished edit" } }); field.focus();
  await m.app.rpc("todo.update", { id: 1, body: "Another Actor's change", title: null });
  m.app.emit(todoEvent("todo.updated", m.store.todos[0]!));
  await within(panel()).findByText("Body: Another Actor's change");
  expect(field.value).toBe("My unfinished edit");
  expect(document.activeElement).toBe(field);
  expect(within(panel()).getAllByRole("separator")).toHaveLength(1);
});

it("u462_failed_fetch_does_not_consume_unread_changes", async () => {
  const m = await mountTodos([todo(1)]);
  const original = m.app.handlers["todo.getHistory"]!;
  m.app.handlers["todo.getHistory"] = () => Promise.reject(new RpcError(-32003, "History unavailable"));
  fireEvent.click(await screen.findByRole("button", { name: "Idle #1 todo 1" }));
  await within(panel()).findByText("History unavailable");
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  fireEvent.dblClick(within(panel()).getByText("todo 1"));
  expect(await within(panel()).findByLabelText("Title")).toBeTruthy();
  m.app.handlers["todo.getHistory"] = original;
  fireEvent.click(within(panel()).getByRole("button", { name: "Retry history" }));
  await within(panel()).findByRole("separator", { name: "Unread changes" });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(1));
});

it("u462_stale_response_cannot_replace_selected_history", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  let answer!: (history: History) => void;
  m.app.handlers["todo.getHistory"] = () => new Promise((resolve) => { answer = resolve; });
  fireEvent.click(await screen.findByRole("button", { name: "Idle #1 todo 1" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.getHistory")).toHaveLength(1));
  m.connected.drawer.close();
  answer({ changes: [{ actor: null, seq: 99, before: null, after: { title: "Stale", body: "", done: false, blockers: [], owner: null } }], unread: 99 });
  await Promise.resolve();
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  expect(screen.queryByText("Title: Stale")).toBeNull();
});

it("u462_closed_drawer_response_does_not_acknowledge_before_unmount", async () => {
  const m = await mountTodos([todo(1)], false);
  let answer!: (history: History) => void;
  m.app.handlers["todo.getHistory"] = () => new Promise((resolve) => { answer = resolve; });

  fireEvent.click(await screen.findByRole("button", { name: "Idle #1 todo 1" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.getHistory")).toHaveLength(1));
  m.connected.drawer.close();
  answer({ changes: [{ actor: null, seq: 99, before: null, after: { title: "Stale", body: "", done: false, blockers: [], owner: null } }], unread: 99 });
  await Promise.resolve();

  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  expect(screen.queryByText("Title: Stale")).toBeNull();
});

it("u462_live_refresh_does_not_acknowledge_changes_absent_from_opening", async () => {
  const m = await mountTodos([todo(1)]);
  await open(m);
  await m.app.rpc("todo.update", { id: 1, body: "Arrived after opening", title: null });
  m.app.emit(todoEvent("todo.updated", m.store.todos[0]!));
  await within(panel()).findByText("Body: Arrived after opening");
  m.connected.drawer.close();
  await open(m);

  expect(within(panel()).getByRole("separator", { name: "Unread changes" }).nextElementSibling?.textContent).toBe("Body: Arrived after opening");
});

it("t17_history_shows_an_owner_only_change", async () => {
  const m = await mountTodos([todo(1)]);
  const values = { title: "todo 1", body: "", done: false, blockers: [] };
  const user = { kind: "user" as const, id: "u", parent: null };
  m.app.handlers["todo.getHistory"] = () => ({ unread: null, changes: [
    { actor: null, seq: 1, before: { ...values, owner: null }, after: { ...values, owner: user } },
    { actor: null, seq: 2, before: { ...values, owner: user }, after: { ...values, owner: null } },
  ] });
  await open(m);
  const history = within(panel()).getByRole("region", { name: "Todo history" });
  expect([...history.querySelectorAll("[data-change]")].map((entry) => entry.textContent)).toEqual(["Owner: Me", "Owner: Unassigned"]);
});
