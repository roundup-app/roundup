import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { assertKind, mountTodos, todo, todoCallsTo as callsTo, todoEvent } from "./testHarness";
import { USER } from "../testing/nodes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const blocked = () => todo(5, { title: "session store", body: "Move the cache.", blocked: true, blockers: [4] });

/** Fresh objects per test: the list state reconciles into the objects it is given. */
const shelf = () => [todo(4, { title: "migrate users" }), blocked(), todo(10, { title: "session tests", blocked: true, blockers: [5] }), todo(7), todo(11, { title: "release notes" })];

stubDialogLayout();

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

// A regex like /#4/ matches both a blocked Todo's own row ("#4 migrate users") and its
// blocker's "#4" link; the row is the candidate that is not that light "word" link.
const rowButton = async (title: RegExp): Promise<HTMLElement> => {
  const row = (await screen.findAllByRole("button", { name: title })).find((candidate) => candidate.className !== "word");

  if (!row) throw new Error(`no row for ${title}`);

  return row;
};

const openDrawerOf = async (title: RegExp, todos = shelf(), reducedMotion = true) => {
  const mounted = await mountTodos(todos, reducedMotion);
  const focusedRow = await rowButton(title);
  focusedRow.focus();
  fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" });
  await within(drawer()).findByRole("button", { name: /^Blocked by/ });
  await within(drawer()).findByRole("region", { name: "Todo history" });

  return mounted;
};

describe("u17 Todo detail", () => {



  it("u17_waits_on_lists_each_blocker_with_its_own_glyph", async () => {
    await openDrawerOf(/#5/);

    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    assertKind(await screen.findByRole("option", { name: /migrate users/ }), "idle");
  });

  it("u17_a_done_blocker_still_shows_under_waits_on_with_the_done_glyph", async () => {
    await openDrawerOf(/#5/, [todo(4, { title: "migrate users", done: true }), blocked()]);

    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    assertKind(await screen.findByRole("option", { name: /migrate users/ }), "done");
  });

  it("u17_blocks_lists_each_todo_that_waits_on_this_one", async () => {
    await openDrawerOf(/#5/);

    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocking/ }));
    assertKind(await screen.findByRole("option", { name: /session tests/ }), "blocked");
  });



  it("u17_opening_the_drawer_reads_history_before_acknowledging_it", async () => {
    const { app } = await openDrawerOf(/#5/);
    expect(callsTo(app, "todo.readHistory")).toHaveLength(0);
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Changes/ }));
    await waitFor(() => expect(callsTo(app, "todo.readHistory")).toHaveLength(1));
    expect(app.calls.map((call) => call.method).filter((method) => method === "todo.getHistory" || method === "todo.readHistory")).toEqual(["todo.getHistory", "todo.readHistory"]);
  });

  it("u17_a_background_refresh_never_calls_todo_get_again", async () => {
    const { app, store } = await openDrawerOf(/#5/);
    store.todos = shelf().map((each) => (each.id === 5 ? { ...each, title: "renamed" } : each));

    app.emit(todoEvent("todo.updated", blocked()));
    await within(drawer()).findByText("renamed", { selector: ":not(.todo-breadcrumb-title)" });

    expect(callsTo(app, "todo.get")).toHaveLength(0);
  });

  it("u17_an_event_changes_what_the_open_drawer_shows", async () => {
    const { app, store } = await openDrawerOf(/#5/);
    store.todos = shelf().map((each) => (each.id === 4 ? { ...each, done: true } : each));

    app.emit(todoEvent("todo.updated", todo(4)));

    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    await waitFor(() => assertKind(screen.getByRole("option", { name: /migrate users/ }), "done"));
  });

  it("u17_plus_blocker_offers_the_other_todos_that_are_not_yet_blockers", async () => {
    await openDrawerOf(/#5/);

    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));

    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["migrate users#4", "todo 7#7", "release notes#11"]);
  });

  it("u17_choosing_an_offered_todo_calls_set_blockers_with_the_whole_new_list", async () => {
    const { app } = await openDrawerOf(/#5/);
    app.handlers["todo.setBlockers"] = () => blocked();
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));

    fireEvent.click(await screen.findByRole("option", { name: /#7/ }));

    await waitFor(() =>
      expect(callsTo(app, "todo.setBlockers")).toEqual([{ method: "todo.setBlockers", params: { id: 5, blockers: [4, 7], expected_change: 2 } }]),
    );
  });

  it("u17_a_conflict_from_set_blockers_shows_inline", async () => {
    const { app } = await openDrawerOf(/#5/);
    app.handlers["todo.setBlockers"] = () => Promise.reject(new RpcError(-32010, "#10 already waits on #5"));
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));

    fireEvent.click(await screen.findByRole("option", { name: /#11/ }));

    expect(await within(drawer()).findByRole("alert", { name: /already waits/ })).toBeTruthy();
  });

  it("u17_complete_calls_todo_complete", async () => {
    const { app } = await openDrawerOf(/#5/);
    app.handlers["todo.complete"] = () => blocked();

    fireEvent.click(within(drawer()).getByRole("checkbox", { name: "Complete session store" }));

    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 5 } }]));
  });


  it("u17_double_clicking_the_title_edits_it_and_leaving_calls_todo_update_once", async () => {
    const { app } = await openDrawerOf(/#5/);
    app.handlers["todo.update"] = () => blocked();
    fireEvent.dblClick(within(drawer()).getByText("session store", { selector: ":not(.todo-breadcrumb-title)" }));
    const field = within(drawer()).getByRole("textbox", { name: "Title" });

    fireEvent.input(field, { target: { value: "session cache" } });
    fireEvent.blur(field);
    fireEvent.blur(field);

    await waitFor(() => expect(callsTo(app, "todo.update")).toEqual([{ method: "todo.update", params: { id: 5, title: "session cache", body: null, expected_change: 2 } }]));
  });

  it("u17_enter_in_the_title_field_leaves_it", async () => {
    const { app } = await openDrawerOf(/#5/);
    app.handlers["todo.update"] = () => blocked();
    fireEvent.dblClick(within(drawer()).getByText("session store", { selector: ":not(.todo-breadcrumb-title)" }));
    const field = within(drawer()).getByRole("textbox", { name: "Title" });
    field.focus();

    fireEvent.input(field, { target: { value: "session cache" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(callsTo(app, "todo.update")).toHaveLength(1));
  });

  it("u17_double_clicking_the_body_edits_it_and_leaving_calls_todo_update_with_the_body", async () => {
    const { app } = await openDrawerOf(/#5/);
    app.handlers["todo.update"] = () => blocked();
    fireEvent.dblClick(within(drawer()).getByText("Move the cache."));
    const field = await within(drawer()).findByRole("textbox", { name: "Body" });
    await waitFor(() => expect(document.activeElement).toBe(field));

    fireEvent.input(field, { target: { value: "Move it to redis." } });
    fireEvent.blur(field);

    await waitFor(() => expect(callsTo(app, "todo.update")).toEqual([{ method: "todo.update", params: { id: 5, title: null, body: "Move it to redis.", expected_change: 2 } }]));
  });

  it("u17_leaving_a_field_with_unchanged_text_calls_nothing", async () => {
    const { app } = await openDrawerOf(/#5/);
    fireEvent.dblClick(within(drawer()).getByText("session store", { selector: ":not(.todo-breadcrumb-title)" }));

    fireEvent.blur(within(drawer()).getByRole("textbox", { name: "Title" }));

    expect(callsTo(app, "todo.update")).toEqual([]);
  });

  it("u17_leaving_a_field_untouched_after_another_actor_renamed_the_todo_calls_nothing_and_shows_their_title", async () => {
    const { app, store } = await openDrawerOf(/#5/);
    fireEvent.dblClick(within(drawer()).getByText("session store", { selector: ":not(.todo-breadcrumb-title)" }));
    const field = within(drawer()).getByRole("textbox", { name: "Title" });
    store.todos = shelf().map((each) => (each.id === 5 ? { ...each, title: "their title" } : each));
    app.emit(todoEvent("todo.updated", todo(5)));
    await screen.findByRole("button", { name: /^Blocked #5 their title/ });

    fireEvent.blur(field);

    expect(callsTo(app, "todo.update")).toEqual([]);
    expect((await within(drawer()).findByText(store.todos.find(item => item.id === 5)!.title, { selector: "p" })).textContent).toBe(store.todos.find(item => item.id === 5)!.title);
  });

  it("u17_a_failed_update_reopens_the_field_with_the_typed_text", async () => {
    const { app } = await openDrawerOf(/#5/);
    app.handlers["todo.update"] = () => Promise.reject(new RpcError(-32602, "title is empty"));
    fireEvent.dblClick(within(drawer()).getByText("session store", { selector: ":not(.todo-breadcrumb-title)" }));
    fireEvent.input(within(drawer()).getByRole("textbox", { name: "Title" }), { target: { value: "typed" } });

    fireEvent.blur(within(drawer()).getByRole("textbox", { name: "Title" }));

    await within(drawer()).findByText(/title is empty/);
    expect(within(drawer()).getByRole("textbox", { name: "Title" })).toHaveProperty("value", "typed");
  });

  it("u17_when_another_actor_deletes_the_open_todo_the_drawer_says_so", async () => {
    const { app, store } = await openDrawerOf(/#5/);
    store.todos = shelf().filter((each) => each.id !== 5);

    app.emit({ actor: USER, name: "todo.deleted", data: { id: 5 } });

    expect((await within(drawer()).findByText(/was deleted/)).textContent).toBe("#5 was deleted");
  });

  it("u17_two_quick_blocker_picks_both_land_the_second_built_on_the_first", async () => {
    const { app } = await openDrawerOf(/#5/);
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    fireEvent.click(await screen.findByRole("option", { name: /#7/ }));
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));

    fireEvent.click(await screen.findByRole("option", { name: /#11/ }));

    await waitFor(() => expect(callsTo(app, "todo.setBlockers")).toHaveLength(2));
    expect(callsTo(app, "todo.setBlockers").map((call) => call.params)).toEqual([
      { id: 5, blockers: [4, 7], expected_change: 2 },
      { id: 5, blockers: [4, 7, 11], expected_change: 6 },
    ]);
  });

  it("u17_a_blocker_change_by_another_actor_between_two_picks_is_not_undone_by_the_second", async () => {
    const { app } = await openDrawerOf(/#5/);
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    fireEvent.click(await screen.findByRole("option", { name: /#7/ }));
    await waitFor(() => expect(callsTo(app, "todo.setBlockers")).toHaveLength(1));
    await app.handlers["todo.setBlockers"]?.({ id: 5, blockers: [] });
    app.emit(todoEvent("todo.updated", todo(5)));
    await within(drawer()).findByRole("button", { name: /^Blocked by 0/ });

    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    fireEvent.click(await screen.findByRole("option", { name: /#11/ }));

    await waitFor(() => expect(callsTo(app, "todo.setBlockers")).toHaveLength(2));
    expect(callsTo(app, "todo.setBlockers")[1]?.params).toEqual({ id: 5, blockers: [11], expected_change: 7 });
  });

  it("u17_a_todo_just_picked_is_not_offered_again_before_the_event_arrives", async () => {
    const { app } = await openDrawerOf(/#5/);
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    fireEvent.click(await screen.findByRole("option", { name: /#7/ }));
    await waitFor(() => expect(callsTo(app, "todo.setBlockers")).toHaveLength(1));
    // The reply, not the event, is what hides #7; the call is recorded a microtask before it lands.
    await new Promise((settle) => setTimeout(settle, 0));

    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));

    await screen.findByRole("option", { name: /#11/ });
    expect(screen.getByRole("option", { name: /#7/ }).querySelector(".lucide-check")).toBeTruthy();
  });


  it("u17_deleting_your_own_todo_while_the_drawer_slides_out_shows_no_deleted_message", async () => {
    const { app, store } = await openDrawerOf(/#5/, shelf(), false);
    app.handlers["todo.delete"] = async (params) => {
      store.todos = shelf().filter((each) => each.id !== 5);

      return { operation: params.operation, deleted: params.ids, missing: [], state: "deleted" };
    };

    fireEvent.click(within(drawer()).getByRole("button", { name: "More actions" }));

    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
    await waitFor(() => expect(callsTo(app, "todo.delete")).toHaveLength(1));
    app.emit({ actor: USER, name: "todo.deleted", data: { id: 5 } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /#5/ })).toBeNull());

    expect(within(drawer()).queryByText(/was deleted/)).toBeNull();
  });

  it("u17_a_pick_that_fails_with_a_bug_is_reported_and_the_next_pick_still_runs", async () => {
    const { app } = await openDrawerOf(/#5/);
    const reportError = vi.fn();

    vi.stubGlobal("reportError", reportError);
    app.handlers["todo.setBlockers"] = (() => {
      let calls = 0;

      return async ({ blockers }) => {
        calls += 1;

        if (calls === 1) throw "boom";

        return { ...blocked(), blockers };
      };
    })();
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    fireEvent.click(await screen.findByRole("option", { name: /#7/ }));
    fireEvent.click(within(drawer()).getByRole("button", { name: /^Blocked by/ }));
    fireEvent.click(await screen.findByRole("option", { name: /#11/ }));

    await waitFor(() => expect(callsTo(app, "todo.setBlockers")).toHaveLength(2));
    expect(reportError).toHaveBeenCalledWith("boom");
  });




});
