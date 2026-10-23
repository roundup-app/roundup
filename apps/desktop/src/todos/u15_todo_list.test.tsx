import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf } from "./testHarness";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const rows = () => within(screen.getByRole("region", { name: "Todos" })).getAllByRole("button").filter((row) => row.classList.contains("shelf-add") || row.classList.contains("todo-row-button")).map((row) => row.textContent?.trim());

describe("u15 Todo list", () => {
  it("u15_open_todos_are_listed_in_id_order_as_glyph_hash_id_title", async () => {
    await mountTodos([todo(7, { title: "split checkout flow" }), todo(3, { title: "refresh tokens" })]);

    await screen.findByText(/refresh tokens/);

    expect(rows()).toEqual(["Todo", "refresh tokens", "split checkout flow"]);
    expect(screen.getByRole("checkbox", { name: "Complete refresh tokens", checked: false })).toBeTruthy();
  });

  it("u15_a_blocked_todo_nests_under_its_first_blocker_and_names_the_others_on_a_second_line", async () => {
    await mountTodos([
      todo(5, { title: "session store", blocked: true, blockers: [6, 4] }),
      todo(6, { title: "later" }),
      todo(4, { title: "migrate" }),
    ]);

    await screen.findByText(/session store/);

    expect(screen.getByRole("button", { name: "Blocked #5 session store" })).toBeTruthy();
    expect(rows().slice(1, 4)).toEqual(["migrate", "later", "session store"]);
    expect(within(todoRowOf(5)).getAllByRole("button", { name: /^Open blocker/ }).map(button => button.getAttribute("aria-label"))).toEqual(["Open blocker migrate", "Open blocker later"]);
  });

  it("u3809_a_done_blocker_is_not_named_and_keeps_its_group", async () => {
    await mountTodos([
      todo(5, { title: "session store", blocked: true, blockers: [4, 6] }),
      todo(4, { done: true }),
      todo(6),
    ]);

    await screen.findByText(/session store/);

    expect(within(todoRowOf(5)).getAllByRole("button", { name: /^Open blocker/ }).map(button => button.getAttribute("aria-label"))).toEqual(["Open blocker todo 6"]);
    expect(document.querySelector('[data-id="5"]')?.getAttribute("aria-level")).toBe("2");
  });

  it("u15_done_todos_fold_into_one_line_counting_them", async () => {
    await mountTodos([todo(1, { done: true, title: "old one" }), todo(2, { done: true }), todo(3)]);

    await screen.findByRole("button", { name: "2 done" });


    expect([rows(), screen.queryByText(/old one/)]).toEqual([["Todo", "todo 3", "2 done"], null]);
  });

  it("u15_clicking_the_done_line_unfolds_the_done_todos", async () => {
    await mountTodos([todo(1, { done: true, title: "old one" })]);

    fireEvent.click(await screen.findByRole("button", { name: "1 done" }));

    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Reopen old one", checked: true }).disabled).toBe(false);
  });


  it.each(["todo.created", "todo.updated"] as const)("u15_%s_refetches_todo_list", async (name) => {
    const { app, store } = await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);
    store.todos = [todo(1), todo(2, { title: "fresh" })];

    app.emit(todoEvent(name, todo(2)));

    expect(await screen.findByText(/fresh/)).toBeTruthy();
  });

  it.each(["todo.unblocked", "todo.deleted"] as const)("u15_%s_refetches_todo_list", async (name) => {
    const { app, store } = await mountTodos([todo(1), todo(2)]);
    await screen.findByText(/todo 2/);
    store.todos = [todo(2)];

    app.emit({ actor: USER, name, data: { id: 1 } });

    await waitFor(() => expect(screen.queryByText(/todo 1/)).toBeNull());
  });

  it("u15_an_event_that_is_not_about_a_todo_does_not_refetch", async () => {
    const { app } = await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);

    app.emit({ actor: USER, name: "rail.changed" });
    app.emit({ actor: USER, name: "pad.changed", data: { name: "notes" } });

    expect(callsTo(app, "todo.list")).toHaveLength(1);
  });

  it("u15_the_list_never_calls_todo_get", async () => {
    const { app, store } = await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);
    store.todos = [todo(1, { title: "changed" })];

    app.emit(todoEvent("todo.updated", todo(1)));
    await screen.findByText(/changed/);

    expect(callsTo(app, "todo.get")).toEqual([]);
  });

  it("u15_a_slow_older_answer_never_overwrites_a_newer_one", async () => {
    const { app, store } = await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);
    let releaseOlder = () => {};

    const older = new Promise<void>((release) => {
      releaseOlder = release;
    });

    app.handlers["todo.list"] = async () => {
      await older;

      return [todo(1, { title: "stale" })];
    };

    app.emit(todoEvent("todo.updated", todo(1)));
    app.handlers["todo.list"] = () => store.todos;
    store.todos = [todo(1, { title: "newest" })];
    app.emit(todoEvent("todo.updated", todo(1)));

    await screen.findByText(/newest/);

    releaseOlder();
    await older;
    await new Promise((settle) => setTimeout(settle));

    expect(screen.queryByText(/stale/)).toBeNull();
  });

  it("u15_a_failed_todo_list_shows_its_message_in_ink", async () => {
    const { app } = await mountTodos([]);
    app.handlers["todo.list"] = () => Promise.reject(new Error("daemon says no"));

    app.emit(todoEvent("todo.updated", todo(1)));

    expect((await screen.findByText(/daemon says no/)).textContent).toBe("daemon says no");
  });

  it("u15_a_refetch_that_changes_one_todo_leaves_every_other_row_in_place", async () => {
    const { app, store } = await mountTodos([todo(1), todo(2)]);
    const before = (await screen.findByRole("button", { name: /#2/ }));
    store.todos = [todo(1, { title: "renamed" }), todo(2)];

    app.emit(todoEvent("todo.updated", todo(1)));

    await screen.findByRole("button", { name: /renamed/ });
    expect(screen.getByRole("button", { name: /#2/ })).toBe(before);
  });

  it("u15_listing_blocked_todos_does_a_constant_amount_of_work_per_todo", async () => {
    const count = 120;
    let reads = 0;

    const counting = <Value,>(value: Value) => ({
      enumerable: true,
      get: () => {
        reads += 1;

        return value;
      },
    });

    const counted = (id: number) => {
      const row = todo(id, { blocked: true });

      Object.defineProperty(row, "id", counting(id));

      return Object.defineProperty(row, "blockers", counting([(id % count) + 1]));
    };

    await mountTodos(Array.from({ length: count }, (_, index) => counted(index + 1)));
    await waitFor(() => expect(within(todoRowOf(count)).getByRole("button", { name: /#120 todo 120/ })).toBeTruthy());

    expect(reads).toBeLessThan(count * 40);
  });

  it("u15_a_list_that_is_gone_stops_listening_to_events", async () => {
    const { app, unmount } = await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);
    unmount();

    app.emit(todoEvent("todo.updated", todo(1)));

    expect(callsTo(app, "todo.list")).toHaveLength(1);
  });
});

it("u3808_the_app_refetches_handed_facts_on_unchanged_value_events_and_keeps_unknown_distinct", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  const owner = { kind: "agent" as const, id: "a", parent: null };
  const first = { todo: 2, owner, seq: 9 };
  const second = { todo: 1, owner, seq: 12 };
  m.app.handlers["todo.listHanded"] = () => [first];
  await m.todos.reload();
  expect(m.todos.handed()).toEqual([first]);
  let before = m.todos.all().map(todo => ({ ...todo }));
  m.app.handlers["todo.listHanded"] = () => [first, second];
  m.app.emit(todoEvent("todo.updated", todo(1)));
  await waitFor(() => expect(m.todos.handed()).toEqual([first, second]));
  expect(m.todos.all()).toEqual(before);
  let answer!: (facts: typeof first[]) => void;
  m.app.handlers["todo.listHanded"] = () => new Promise(resolve => { answer = resolve; });
  m.store.todos = [todo(1, { title: "fresh list with pending facts" }), todo(2)];
  const pending = m.todos.reload();
  expect(m.todos.handed()).toBeNull();
  await waitFor(() => expect(m.todos.all()[0]?.title).toBe("fresh list with pending facts"));
  before = m.todos.all().map(todo => ({ ...todo }));
  answer([first, second]);
  await pending;
  expect(m.todos.handed()).toEqual([first, second]);
  m.app.handlers["todo.listHanded"] = () => Promise.reject(new Error("facts unavailable"));
  await m.todos.reload();
  expect(m.todos.handed()).toBeNull();
  expect(m.todos.handedFailure()).toBe("facts unavailable");
  expect(m.todos.all()).toEqual(before);
  m.app.handlers["todo.listHanded"] = () => [];
  await m.todos.reload();
  expect(m.todos.handed()).toEqual([]);
  expect(m.todos.handedFailure()).toBeNull();
  expect(m.app.calls.filter(call => call.method !== "todo.list" && call.method !== "todo.listHanded").filter(call => call.method.startsWith("todo."))).toEqual([]);
});
