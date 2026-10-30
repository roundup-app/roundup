import { DisplayClockContext } from "../state/clock";
import type { JSX } from "solid-js";
import { cleanup, render as renderWithoutClock, screen, waitFor } from "@solidjs/testing-library";
import { showEverything, withScopeRow } from "../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { event } from "../testing/nodes";
import { mountTodos, todo } from "./testHarness";
import { Todos } from "./Todos";

const render = (view: () => JSX.Element) => renderWithoutClock(() => <DisplayClockContext.Provider value={() => () => 0}>{view()}</DisplayClockContext.Provider>);

afterEach(cleanup);

describe("u38 empty Todos", () => {

  it("u4464_no_empty_view_before_the_first_answer_u38_todos_todo_list_answers", async () => {
    const app = createFakeApp();
    const pending = Promise.withResolvers<ReturnType<typeof todo>[]>();

    app.handlers["todo.list"] = () => pending.promise;

    app.handlers["rail.tree"] = () => withScopeRow([]);
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
    await showEverything(connected);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <Todos />
      </ConnectedProjectContext.Provider>
    ));

    expect(screen.queryByRole("group", { name: /No Todos/ })).toBeNull();

    pending.resolve([]);

    expect(await screen.findByRole("group", { name: /No Todos/ })).toBeTruthy();
  });

  it("u38_no_todos_yet_disappears_once_a_todo_exists", async () => {
    const { app, store } = await mountTodos([]);

    await screen.findByText("No Todos yet");

    store.todos = [todo(1)];
    app.emit(event({ name: "todo.created", data: todo(1) }));

    await screen.findByText(/todo 1/);
    expect(screen.queryByText("No Todos yet")).toBeNull();
  });

  it("u38_a_stale_first_todo_list_reply_never_sets_no_todos_yet_before_the_newest_one_lands", async () => {
    const app = createFakeApp();
    const replies: ReturnType<typeof Promise.withResolvers<ReturnType<typeof todo>[]>>[] = [];

    app.handlers["todo.list"] = () => {
      const reply = Promise.withResolvers<ReturnType<typeof todo>[]>();

      replies.push(reply);

      return reply.promise;
    };

    app.handlers["rail.tree"] = () => withScopeRow([]);
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
    await showEverything(connected);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <Todos />
      </ConnectedProjectContext.Provider>
    ));

    await waitFor(() => expect(replies.length).toBe(1));

    app.emit(event({ name: "todo.created", data: todo(1) }));
    await waitFor(() => expect(replies.length).toBe(2));

    replies[0]?.resolve([]);
    await new Promise((done) => setTimeout(done, 0));

    expect(screen.queryByText("No Todos yet")).toBeNull();

    replies[1]?.resolve([todo(1)]);

    expect(await screen.findByText(/todo 1/)).toBeTruthy();
    expect(screen.queryByText("No Todos yet")).toBeNull();
  });

  it("u38_no_todos_yet_returns_once_the_last_todo_is_deleted", async () => {
    const { app, store } = await mountTodos([todo(1)]);

    await screen.findByText(/todo 1/);

    store.todos = [];
    app.emit(event({ name: "todo.deleted", data: { id: 1 } }));

    expect(await screen.findByText("No Todos yet")).toBeTruthy();
    expect(screen.queryByText(/todo 1/)).toBeNull();
  });

  it("u38_a_retry_after_a_failed_todo_list_keeps_the_failure_until_the_reply_arrives", async () => {
    const app = createFakeApp();
    const retry = Promise.withResolvers<ReturnType<typeof todo>[]>();
    let calls = 0;

    app.handlers["todo.list"] = () => {
      calls += 1;

      return calls <= 2 ? Promise.reject(new Error("boom")) : retry.promise;
    };

    app.handlers["rail.tree"] = () => withScopeRow([]);
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
    await showEverything(connected);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <Todos />
      </ConnectedProjectContext.Provider>
    ));

    const exhausted = await screen.findByRole("alert");

    expect(calls).toBe(2);

    app.emit(event({ name: "todo.created", data: todo(1) }));
    await waitFor(() => expect(calls).toBe(3));

    expect(screen.getByRole("alert")).toBe(exhausted);

    retry.resolve([]);

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(calls).toBe(3);
  });

  it("u38_a_failed_initial_todo_list_shows_its_message_not_no_todos_yet", async () => {
    const app = createFakeApp();

    app.handlers["todo.list"] = () => {
      throw new Error("daemon says no");
    };

    app.handlers["rail.tree"] = () => withScopeRow([]);
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
    await showEverything(connected);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <Todos />
      </ConnectedProjectContext.Provider>
    ));

    expect((await screen.findByText(/daemon says no/)).textContent).toBe("daemon says no");
    expect(screen.queryByText("No Todos yet")).toBeNull();
  });
});
