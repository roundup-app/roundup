import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { History } from "@contracts/todo/History";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async (mounted: Awaited<ReturnType<typeof mountTodos>>, id = 1) => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^Idle #${id} `) }));
  await within(panel()).findByRole("region", { name: "Todo history" });
  await within(panel()).findByRole("button", { name: /^Changes/ });
};

/** U3728: entries and the read wait for the user to open the line. */
const disclose = async (mounted: Awaited<ReturnType<typeof mountTodos>>) => {
  const before = todoCallsTo(mounted.app, "todo.readHistory").length;
  fireEvent.click(within(panel()).getByRole("button", { name: /^Changes/ }));
  await waitFor(() => expect(todoCallsTo(mounted.app, "todo.readHistory").length).toBeGreaterThan(before));
};

it("u462_only_the_open_drawer_requests_history", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  expect(todoCallsTo(m.app, "todo.getHistory")).toHaveLength(0);
  await open(m);
  expect(todoCallsTo(m.app, "todo.getHistory").map((call) => call.params)).toEqual([{ id: 1 }]);
  expect(todoCallsTo(m.app, "todo.get")).toHaveLength(0);
});

it.each([false, true])("u462_live_history_keeps_edit_and_focus_previous_read_%s", async (prior) => {
  const m = await mountTodos([todo(1)]);

  if (prior) await m.app.rpc("todo.get", { id: 1 });
  await open(m); await disclose(m);
  fireEvent.dblClick(within(panel()).getByText("todo 1"));
  const field = await within(panel()).findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });
  fireEvent.input(field, { target: { value: "My unfinished edit" } }); field.focus();
  await m.app.rpc("todo.update", { id: 1, body: "Another Actor's change", title: null });
  m.app.emit(todoEvent("todo.updated", m.store.todos[0]!));
  await within(panel()).findByText(/^Wrote the body( · |$)/);
  expect(field.value).toBe("My unfinished edit");
  expect(document.activeElement).toBe(field);
});

it("u462_failed_fetch_does_not_consume_unread_changes", async () => {
  const m = await mountTodos([todo(1)]);
  const original = m.app.handlers["todo.getHistory"]!;
  m.app.handlers["todo.getHistory"] = () => Promise.reject(new RpcError(-32003, "History unavailable"));
  fireEvent.click(await screen.findByRole("button", { name: "Idle #1 todo 1" }));
  fireEvent.click(await within(panel()).findByRole("button", { name: "Changes" }));
  await within(panel()).findByText("History unavailable");
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  fireEvent.dblClick(within(panel()).getByText("todo 1"));
  expect(await within(panel()).findByLabelText("Title")).toBeTruthy();
  m.app.handlers["todo.getHistory"] = original;
  fireEvent.click(within(panel()).getByRole("button", { name: "Retry history" }));
  await within(panel()).findByText(/^Created todo 1( · |$)/);
  await waitFor(() => expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(1));
});

it("u462_stale_response_cannot_replace_selected_history", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  let answer!: (history: History) => void;
  m.app.handlers["todo.getHistory"] = () => new Promise((resolve) => { answer = resolve; });
  fireEvent.click(await screen.findByRole("button", { name: "Idle #1 todo 1" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.getHistory")).toHaveLength(1));
  m.connected.drawer.close();
  answer({ changes: [{ actor: null, changed_at: null, seq: 99, before: null, after: { title: "Stale", body: "", done: false, blockers: [], owner: null } }], unread: 99 });
  await Promise.resolve();
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  expect(screen.queryByText("Created Stale")).toBeNull();
});

it("u462_closed_drawer_response_does_not_acknowledge_before_unmount", async () => {
  const m = await mountTodos([todo(1)], false);
  let answer!: (history: History) => void;
  m.app.handlers["todo.getHistory"] = () => new Promise((resolve) => { answer = resolve; });

  fireEvent.click(await screen.findByRole("button", { name: "Idle #1 todo 1" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.getHistory")).toHaveLength(1));
  m.connected.drawer.close();
  answer({ changes: [{ actor: null, changed_at: null, seq: 99, before: null, after: { title: "Stale", body: "", done: false, blockers: [], owner: null } }], unread: 99 });
  await Promise.resolve();

  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  expect(screen.queryByText("Created Stale")).toBeNull();
});

it("u462_live_refresh_does_not_acknowledge_changes_absent_from_opening", async () => {
  const m = await mountTodos([todo(1)]);
  await open(m); await disclose(m);
  await m.app.rpc("todo.update", { id: 1, body: "Arrived after opening", title: null });
  m.app.emit(todoEvent("todo.updated", m.store.todos[0]!));
  await within(panel()).findByText(/^Wrote the body( · |$)/);
  m.connected.drawer.close();
  await open(m);

  expect(within(panel()).getByRole("button", { name: "Changes · 2" }).querySelector("[data-state]")?.getAttribute("data-state")).toBe("unread");
});

it("t17_history_shows_an_owner_only_change", async () => {
  const m = await mountTodos([todo(1)]);
  const values = { title: "todo 1", body: "", done: false, blockers: [] };
  const user = { kind: "user" as const, id: "u", parent: null };
  m.app.handlers["todo.getHistory"] = () => ({ unread: null, changes: [
    { actor: null, changed_at: null, seq: 1, before: { ...values, owner: null }, after: { ...values, owner: user } },
    { actor: null, changed_at: null, seq: 2, before: { ...values, owner: user }, after: { ...values, owner: null } },
  ] });
  await open(m); await disclose(m);
  const history = within(panel()).getByRole("region", { name: "Todo history" });
  expect([...history.querySelectorAll("[data-change]")].map((entry) => entry.textContent)).toEqual(["Assigned to Me", "Unassigned"]);
});

it("u3728_changes_wait_behind_one_line", async () => {
  const m = await mountTodos([todo(1)]); await open(m);
  const line = within(panel()).getByRole("button", { name: "Changes · 1" });
  expect(line.getAttribute("aria-expanded")).toBe("false");
  expect(line.querySelector("[data-state]")?.getAttribute("data-state")).toBe("unread");
  expect(panel().querySelector("[data-change]")).toBeNull();
  expect(within(panel()).queryByRole("separator")).toBeNull();
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
});

it("u3728_entries_read_as_past_tense_lines", async () => {
  const m = await mountTodos([todo(1)]);
  const values = { title: "todo 1", body: "", done: false, blockers: Array.of<number>(), owner: null };
  const agent = { kind: "agent" as const, id: "a1", parent: null };
  const stamp = Date.UTC(2026, 5, 3, 14, 5);
  m.app.handlers["todo.getHistory"] = () => ({ unread: null, changes: [
    { actor: null, changed_at: null, seq: 1, before: values, after: { ...values, title: "jbkhnj" } },
    { actor: null, changed_at: null, seq: 2, before: { ...values, body: "x" }, after: values },
    { actor: null, changed_at: null, seq: 3, before: values, after: { ...values, done: true } },
    { actor: null, changed_at: null, seq: 4, before: { ...values, done: true }, after: values },
    { actor: null, changed_at: null, seq: 5, before: values, after: { ...values, blockers: [9] } },
    { actor: agent, changed_at: stamp, seq: 6, before: values, after: { ...values, owner: agent } },
  ] });
  await open(m); await disclose(m);
  const shown = [...panel().querySelectorAll("[data-change]")].map((entry) => entry.textContent);
  expect(shown.slice(0, 5)).toEqual(["Renamed to jbkhnj", "Cleared the body", "Marked done", "Reopened", "Now waits on #9"]);
  expect(shown[5]).toMatch(/^Assigned to .+ · .+ · .+\d.*$/);
});

it("u462_a_handoff_renders_as_handed_to_the_agent", async () => {
  const m = await mountTodos([todo(1)]);
  const values = { title: "todo 1", body: "", done: false, blockers: Array.of<number>(), owner: null };
  const agent = { kind: "agent" as const, id: "a1", parent: null };
  const owned = { ...values, owner: agent };
  m.app.handlers["todo.getHistory"] = () => ({ unread: null, changes: [
    { actor: null, changed_at: null, seq: 1, before: values, after: owned },
    { actor: { kind: "ext" as const, id: "rupd", parent: null }, changed_at: null, seq: 2, handed: agent, before: owned, after: owned },
    { actor: null, changed_at: null, seq: 3, before: owned, after: { ...owned, done: true } },
  ] });
  await open(m); await disclose(m);
  const shown = [...panel().querySelectorAll("[data-change]")].map((entry) => entry.textContent);
  expect(shown).toHaveLength(3);
  expect(shown[1]).toMatch(/^Handed to /);
  expect(shown[1]).not.toMatch(/rupd/);
  expect(shown[2]).toBe("Marked done");
});

it("u3728_opening_marks_read_once", async () => {
  const m = await mountTodos([todo(1)]); await open(m);
  await disclose(m);
  expect(within(panel()).getByText(/^Created todo 1( · |$)/)).toBeTruthy();
  fireEvent.click(within(panel()).getByRole("button", { name: /^Changes/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /^Changes/ }));
  await waitFor(() => expect(within(panel()).getByRole("button", { name: "Changes · 1" }).querySelector("[data-state]")?.getAttribute("data-state")).toBe("read"));
  fireEvent.click(within(panel()).getByRole("button", { name: /^Changes/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /^Changes/ }));
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(1);
});

it("u3728_failed_read_retries_without_consuming_unread", async () => {
  const m = await mountTodos([todo(1)]); await open(m);
  const original = m.app.handlers["todo.readHistory"]!;
  m.app.handlers["todo.readHistory"] = () => Promise.reject(new RpcError(-32003, "Read unavailable"));
  fireEvent.click(within(panel()).getByRole("button", { name: /^Changes/ }));
  await within(panel()).findByText("Read unavailable");
  const count = () => within(panel()).getByRole("button", { name: "Changes · 1" }).querySelector("[data-state]")?.getAttribute("data-state");
  expect(count()).toBe("unread");
  m.app.handlers["todo.readHistory"] = original;
  fireEvent.click(within(panel()).getByRole("button", { name: "Retry history" }));
  await waitFor(() => expect(count()).toBe("read"));
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(2);
});
