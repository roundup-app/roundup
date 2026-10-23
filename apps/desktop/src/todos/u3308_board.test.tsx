import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { HELP_ROWS, hintsFor } from "../keys/chords";
import { agent, event, workstream } from "../testing/nodes";
import { mountTodos, todo, todoEvent, todoCallsTo } from "./testHarness";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const owner = { kind: "agent" as const, id: "a", parent: null };

it("u3309_a_digit_assigns_to_that_agent_once_and_focus_returns_to_the_row", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "", { name: "Writer" })]);
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });

  row.focus();
  fireEvent.keyDown(row, { key: "1", code: "Digit1" });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.assign").map(call => call.params)).toEqual([{ id: 1, owner }]));
  await waitFor(() => expect(document.activeElement?.closest("[data-todo]")?.getAttribute("data-todo")).toBe("1"));
});

it("u3308_busy_until_is_now_plus_the_sum_of_estimates_and_done_todos_add_nothing", async () => {
  await mountTodos([todo(1, { owner, estimate_minutes: 30 }), todo(2, { owner, estimate_minutes: 45 }), todo(3, { owner, estimate_minutes: 100, done: true })], true, [agent("a", "idle", "")], false, undefined, () => new Date(2026, 9, 23, 13, 0).getTime());
  await waitFor(() => expect(screen.getByText("busy until 14:15")).toBeTruthy());
});

it("u3308_missing_estimates_add_nothing_and_say_so", async () => {
  const m = await mountTodos([todo(1, { owner, estimate_minutes: 30 }), todo(2, { owner })], true, [agent("a", "idle", "")], false, undefined, () => new Date(2026, 9, 23, 13, 0).getTime());
  await waitFor(() => expect(screen.getByText("busy until 13:30 + 1 without estimate")).toBeTruthy());
  m.store.todos = m.store.todos.map(row => ({ ...row, estimate_minutes: null }));
  m.app.emit(todoEvent("todo.updated", m.store.todos[0]!));
  await waitFor(() => expect(screen.getByText("no estimates")).toBeTruthy());
});

it("u3308_the_line_follows_an_estimate_change_and_the_minute", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2026, 9, 23, 13, 0));
  const m = await mountTodos([todo(1, { owner, estimate_minutes: 30 })], true, [agent("a", "idle", "")], false, undefined, Date.now);

  await waitFor(() => expect(screen.getByText("busy until 13:30")).toBeTruthy());
  await vi.advanceTimersByTimeAsync(60_000);
  expect(screen.getByText("busy until 13:31")).toBeTruthy();
  m.store.todos = [todo(1, { owner, estimate_minutes: 45 })];
  m.app.emit(todoEvent("todo.updated", m.store.todos[0]!));
  await waitFor(() => expect(screen.getByText("busy until 13:46")).toBeTruthy());
});

it("u3309_a_digit_without_an_agent_or_for_the_own_owner_calls_nothing", async () => {
  const m = await mountTodos([todo(1, { owner })], true, [agent("a", "idle", "")]);
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });

  row.focus();

  for (const key of ["1", "2", "9"]) fireEvent.keyDown(row, { key, code: `Digit${key}` });
  expect(todoCallsTo(m.app, "todo.assign")).toHaveLength(0);
});

it("u3309_enter_arrows_enter_assigns_once_and_esc_cancels", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "", { name: "Writer" })]);
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });
  const key = (key: string) => fireEvent.keyDown(document.activeElement!, { key, code: key });

  row.focus();
  key("Enter"); key("ArrowUp");
  expect(screen.getByRole("status").textContent).toBe("Move #1 to Writer");
  key("Escape");
  expect(todoCallsTo(m.app, "todo.assign")).toHaveLength(0);
  key("Enter"); key("ArrowUp"); key("Enter");
  await waitFor(() => expect(todoCallsTo(m.app, "todo.assign").map(call => call.params)).toEqual([{ id: 1, owner }]));
});

it("u3309_the_keys_are_inert_in_fields_with_modifiers_and_on_done_rows", async () => {
  const m = await mountTodos([todo(1), todo(2, { done: true })], true, [agent("a", "idle", "")]);
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });

  row.focus();

  for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"]) for (const key of ["1", "Enter"]) fireEvent.keyDown(row, { key, code: key === "1" ? "Digit1" : key, [modifier]: true });
  fireEvent.click(screen.getByRole("button", { name: "add todo to Unassigned" }));
  const field = await screen.findByRole("textbox", { name: "New Todo title" });
  fireEvent.keyDown(field, { key: "1", code: "Digit1" });
  fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
  fireEvent.click(document.querySelector(".shelf-done-line button")!);
  const done = await screen.findByRole("button", { name: "Done #2 todo 2" });
  done.focus();
  fireEvent.keyDown(done, { key: "1", code: "Digit1" });
  expect(todoCallsTo(m.app, "todo.assign")).toHaveLength(0);
});

it("u3310_the_switch_calls_set_auto_once_and_follows_the_event", async () => {
  const m = await mountTodos([todo(1, { home: "w" })], true, [workstream("w", { auto: false })]);
  m.connected.rail.select("w");
  const control = await screen.findByRole("switch", { name: "Auto" });
  m.app.handlers["workstream.setAuto"] = () => null;
  fireEvent.click(control);
  await waitFor(() => expect(todoCallsTo(m.app, "workstream.setAuto").map(call => call.params)).toEqual([{ id: "w", auto: true }]));
  expect(control.getAttribute("aria-checked")).toBe("false");
  m.app.handlers["rail.tree"] = () => [workstream("w", { auto: true })];
  m.app.emit(event({ name: "workstream.updated", data: { id: "w", auto: true } }));
  await waitFor(() => expect(control.getAttribute("aria-checked")).toBe("true"));
});

it("u3310_the_switch_is_absent_without_a_workstream", async () => {
  await mountTodos([todo(1)]);
  expect(screen.queryByRole("switch", { name: "Auto" })).toBeNull();
});

it("u3310_a_refused_call_keeps_the_state_and_shows_its_cause", async () => {
  const m = await mountTodos([todo(1, { home: "w" })], true, [workstream("w", { auto: false })]);

  m.connected.rail.select("w");
  m.app.handlers["workstream.setAuto"] = () => { throw new RpcError(-32003, "Supervisor unavailable; start it and retry"); };

  const control = await screen.findByRole("switch", { name: "Auto" });

  fireEvent.click(control);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Supervisor unavailable; start it and retry"));
  expect(control.getAttribute("aria-checked")).toBe("false");
});

it("u3309_a_refused_digit_assignment_shows_its_cause_and_keeps_the_owner", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "")]);
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });

  m.app.handlers["todo.assign"] = () => { throw new RpcError(-32003, "Agent unavailable; choose another owner"); };

  row.focus();
  fireEvent.keyDown(row, { key: "1", code: "Digit1" });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Agent unavailable; choose another owner"));
  expect(row.closest<HTMLElement>("[data-shelf-group]")?.dataset.shelfGroup).toBe("unassigned");
});

it("u3309_the_digits_are_registered_shelf_bindings_listed_in_help", async () => {
  const agents = Array.from({ length: 9 }, (_, at) => agent(`a${at + 1}`, "idle", "", { name: `Writer ${at + 1}`, order: at }));
  const m = await mountTodos([todo(1)], true, agents);
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });

  for (let digit = 1; digit <= 9; digit++) {
    row.focus();
    fireEvent.keyDown(row, { key: String(digit), code: `Digit${digit}` });
    await waitFor(() => expect(todoCallsTo(m.app, "todo.assign")).toHaveLength(digit));
  }

  expect(todoCallsTo(m.app, "todo.assign").map(call => call.params)).toEqual(agents.map(agent => ({ id: 1, owner: { kind: "agent", id: agent.id, parent: null } })));
  expect(HELP_ROWS).toContainEqual(expect.objectContaining({ keys: "1–9" }));
  expect(hintsFor("shelf")).toContainEqual(expect.objectContaining({ keys: "1–9" }));
});

it("u3308_idle_groups_follow_the_workstream_and_lift_reveals_every_owner", async () => {
  const m = await mountTodos([todo(1, { home: "w" })], true, [workstream("w"), workstream("other"), agent("a", "idle", "", { name: "Writer", parent: "w" }), agent("b", "idle", "", { name: "Other", parent: "other" })]);

  expect(document.querySelector('[data-shelf-group="a"]')).toBeNull();
  m.connected.rail.select("w");
  await waitFor(() => expect(document.querySelector('[data-shelf-group="a"]')?.textContent).toContain("free now"));
  expect(document.querySelector('[data-shelf-group="b"]')).toBeNull();
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });

  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  expect(document.querySelector('[data-shelf-group="b"]')).toBeTruthy();
  fireEvent.keyDown(row, { key: "Escape", code: "Escape" });
  expect(document.querySelector('[data-shelf-group="b"]')).toBeNull();
});

it("u3311_a_door_hand_off_reveals_folded_destinations_without_stealing_focus", async () => {
  const other = { kind: "agent" as const, id: "b", parent: null };
  const m = await mountTodos([todo(1, { owner }), todo(2, { owner: other }), todo(3), todo(4)], true, [agent("a", "idle", "", { name: "Writer" }), agent("b", "idle", "", { name: "Reviewer", order: 1 })]);

  for (const id of ["a", "b"]) fireEvent.click(document.querySelector(`[data-shelf-group="${id}"] [data-part="branch-control"]`)!);
  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  fireEvent.input(input, { target: { value: "keep writing" } });
  input.focus();
  m.store.todos = m.store.todos.map(todo => todo.id === 3 ? { ...todo, owner } : todo.id === 4 ? { ...todo, owner: other } : todo);
  m.app.emit({ ...todoEvent("todo.updated", m.store.todos[2]!), actor: owner });
  await waitFor(() => expect(document.querySelector('[data-shelf-group="a"] [data-todo="3"]')).toBeTruthy());
  await waitFor(() => expect(document.querySelector('[data-shelf-group="b"] [data-todo="4"]')).toBeTruthy());
  expect(document.querySelector('[data-shelf-group="a"] [data-part="branch-content"]')?.hasAttribute("hidden")).toBe(false);
  expect(document.querySelector('[data-shelf-group="b"] [data-part="branch-content"]')?.hasAttribute("hidden")).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("keep writing");
});
