import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { door } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const bar = () => screen.queryByRole("progressbar", { name: "Todos done" });

const count = () => document.querySelector("[data-todo-count]")?.textContent ?? null;

const finish = ({ app, store }: Awaited<ReturnType<typeof mountTodos>>, id: number, done = true) => {
  store.todos = store.todos.map((item) => (item.id === id ? { ...item, done } : item));
  app.emit(todoEvent("todo.updated", store.todos.find((item) => item.id === id)!));
};

const playing = () => document.querySelectorAll("[data-motion='play']").length;

describe("u3768 the Todos list shows a progress bar", () => {
  it("u3768_the_bar_reads_done_over_total", async () => {
    await mountTodos([todo(1), todo(2, { done: true }), todo(3), todo(4, { done: true })]);

    const track = await screen.findByRole("progressbar", { name: "Todos done" });

    expect(track.closest(".app-progress")?.getAttribute("data-max")).toBe("4");
    expect(track.getAttribute("aria-valuemin")).toBe("0");
    expect(track.getAttribute("aria-valuemax")).toBe("4");
    expect(track.getAttribute("aria-valuenow")).toBe("2");
    expect(count()).toBe("2/4");
    expect(track.querySelector<HTMLElement>(".app-progress-fill")?.style.getPropertyValue("--fill")).toBe("0.5");
  });

  it("u3768_the_count_follows_the_refetched_list", async () => {
    const mounted = await mountTodos([todo(1), todo(2)]);

    await waitFor(() => expect(count()).toBe("0/2"));
    mounted.store.todos = [todo(1, { done: true }), todo(2)];
    expect(count()).toBe("0/2");

    mounted.app.emit(todoEvent("todo.updated", mounted.store.todos[0]!));
    await waitFor(() => expect(count()).toBe("1/2"));
  });

  it("u3768_an_empty_scope_shows_no_bar", async () => {
    await mountTodos([]);

    await screen.findByText("No Todos yet");
    expect(bar()).toBeNull();
    expect(count()).toBeNull();
  });

  it("u3768_the_bar_calls_nothing_and_takes_no_focus", async () => {
    const { app } = await mountTodos([todo(1)]);
    const track = await screen.findByRole("progressbar", { name: "Todos done" });

    expect(track.closest(".todo-progress")?.querySelectorAll("button, input, [tabindex]")).toHaveLength(0);
    expect(todoCallsTo(app, "todo.complete")).toHaveLength(0);
  });
});

describe("u3770 a finishing Todo plays one motion", () => {
  it("u3770_ticking_plays_the_tick_ring_strike_bar_and_count", async () => {
    const mounted = await mountTodos([todo(1), todo(2)], false);

    await waitFor(() => expect(count()).toBe("0/2"));
    expect(playing()).toBe(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Complete todo 1" }));
    await waitFor(() => expect(todoCallsTo(mounted.app, "todo.complete")).toHaveLength(1));
    expect(count()).toBe("0/2");
    mounted.app.emit(todoEvent("todo.updated", mounted.store.todos[0]!));
    await waitFor(() => expect(count()).toBe("1/2"));

    expect(document.querySelector(".app-progress")?.getAttribute("data-motion")).toBe("play");
    expect(document.querySelector("[data-todo='1']")?.getAttribute("data-motion")).toBe("play");
    expect(document.querySelector<HTMLInputElement>("[data-todo='1'] input.todo-tick")?.checked).toBe(true);
  });

  it("u3770_unticking_plays_the_reverse", async () => {
    const mounted = await mountTodos([todo(1, { done: true }), todo(2)], false);

    await waitFor(() => expect(count()).toBe("1/2"));
    fireEvent.click(screen.getByRole("button", { name: /1 done/ }));
    finish(mounted, 1, false);
    await waitFor(() => expect(count()).toBe("0/2"));

    expect(document.querySelector(".app-progress")?.getAttribute("data-motion")).toBe("play");
    expect(document.querySelector("[data-todo='1']")?.getAttribute("data-motion")).toBe("play");
  });

  it("u3770_an_agent_finishing_a_shown_todo_plays_the_motion", async () => {
    const mounted = await mountTodos([todo(1), todo(2)], false);

    await waitFor(() => expect(count()).toBe("0/2"));
    finish(mounted, 2);
    await waitFor(() => expect(count()).toBe("1/2"));

    expect(playing()).toBeGreaterThan(0);
  });

  it("u3770_a_finish_in_a_folded_group_settles_without_playing", async () => {
    const mounted = await mountTodos([todo(1), todo(2)], false);

    fireEvent.click(document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);
    finish(mounted, 1);
    await waitFor(() => expect(count()).toBe("1/2"));

    expect(playing()).toBe(0);
    fireEvent.click(document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);
    expect(document.querySelector('.shelf-groups [data-todo="1"]')).toBeNull();
  });

  it("u3770_a_finishing_row_keeps_its_place_until_its_strike_ends", async () => {
    const mounted = await mountTodos([todo(1), todo(2), todo(3)], false);
    const order = () => [...document.querySelectorAll('.shelf-groups [data-todo]')].map(row => row.getAttribute("data-todo"));

    finish(mounted, 2);
    await waitFor(() => expect(count()).toBe("1/3"));

    expect(order()).toEqual(["1", "2", "3"]);
    fireEvent.animationEnd(document.querySelector('[data-todo="2"] .todo-strike')!);
    expect(order()).toEqual(["1", "3"]);
  });

  it("u3770_a_finish_out_of_view_moves_nothing", async () => {
    const mounted = await mountTodos([todo(1, { home: "w1" }), todo(2)], false, [door("w1", "idle", "idle", { name: "one" })]);

    mounted.connected.rail.select("w1");
    await waitFor(() => expect(count()).toBe("0/1"));
    mounted.store.todos = [todo(1, { home: "w1" }), todo(2, { done: true })];
    mounted.app.emit(todoEvent("todo.updated", mounted.store.todos[1]!));
    await mounted.todos.reload();

    expect(count()).toBe("0/1");
    expect(playing()).toBe(0);
  });

  it("u3770_opening_and_switching_show_the_end_state_without_motion", async () => {
    const mounted = await mountTodos([todo(1, { home: "w1", done: true }), todo(2, { home: "w1" }), todo(3)], false, [door("w1", "idle", "idle", { name: "one" })]);

    await waitFor(() => expect(count()).toBe("1/3"));
    expect(playing()).toBe(0);
    mounted.connected.rail.select("w1");
    await waitFor(() => expect(count()).toBe("1/2"));
    expect(playing()).toBe(0);
  });

  it("u3770_a_refetch_with_no_change_plays_nothing", async () => {
    const mounted = await mountTodos([todo(1, { done: true }), todo(2)], false);

    await waitFor(() => expect(count()).toBe("1/2"));
    mounted.app.emit(todoEvent("todo.updated", mounted.store.todos[1]!));
    await mounted.todos.reload();

    expect(playing()).toBe(0);
  });

  it("u3770_a_burst_retargets_and_ends_on_the_last_state", async () => {
    const mounted = await mountTodos([todo(1), todo(2), todo(3)], false);

    await waitFor(() => expect(count()).toBe("0/3"));
    finish(mounted, 1);
    finish(mounted, 2);
    finish(mounted, 3);
    await waitFor(() => expect(count()).toBe("3/3"));

    expect(document.querySelectorAll(".app-progress[data-motion='play']")).toHaveLength(1);
    expect(screen.getByRole("progressbar", { name: "Todos done" }).getAttribute("aria-valuenow")).toBe("3");
  });

  it("u3770_reduced_motion_shows_the_end_state", async () => {
    const mounted = await mountTodos([todo(1), todo(2)], true);

    await waitFor(() => expect(count()).toBe("0/2"));
    finish(mounted, 1);
    await waitFor(() => expect(count()).toBe("1/2"));

    expect(playing()).toBe(0);
  });

  it("u3770_a_preference_change_mid_motion_settles_it", async () => {
    const mounted = await mountTodos([todo(1), todo(2)], false);

    await waitFor(() => expect(count()).toBe("0/2"));
    finish(mounted, 1);
    await waitFor(() => expect(playing()).toBeGreaterThan(0));
    mounted.setReduced(true);
    await waitFor(() => expect(playing()).toBe(0));
  });
});
