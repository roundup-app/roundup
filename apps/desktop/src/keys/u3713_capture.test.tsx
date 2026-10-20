import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { showEverything, withScopeRow } from "../testing/showEverything";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { Capture } from "../todos/Capture";
import { Todos } from "../todos/Todos";
import { todo, todoCallsTo as callsTo } from "../todos/testHarness";
import { Help } from "./Help";
import { leaderKey } from "./leaderFixture";
import { Leader } from "./Leader";
import { armLeader, leaderArmed } from "./registry";

afterEach(cleanup);

const mount = async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow([]);
  const store: TodoStore = { todos: [] };
  Object.assign(app.handlers, todoHandlers(store, () => {}));

  const connected = await connectProject(app, { name: "p", path: `/test-capture/${crypto.randomUUID()}` }, () => true, () => 0);

  await showEverything(connected);
  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <button data-testid="before">before</button>
      <Todos />
      <Leader />
      <Capture />
      <Help />
    </ConnectedProjectContext.Provider>
  ));

  const before = screen.getByTestId("before");

  before.focus();

  return { app, store, before, connected };
};

const field = (): HTMLTextAreaElement | null => screen.queryByRole<HTMLTextAreaElement>("textbox", { name: "Capture a Todo" });

const openField = async () => {
  leaderKey("KeyT");

  return waitFor(() => {
    expect(field()).not.toBeNull();

    return field()!;
  });
};

const type = (input: HTMLElement, value: string) => fireEvent.input(input, { target: { value } });

const press = (input: HTMLElement, init: KeyboardEventInit = {}) => fireEvent.keyDown(input, { key: "Enter", code: "Enter", ...init });

describe("u3713 the leader opens the capture field", () => {
  it("u3713_leader_t_opens_a_focused_empty_field_without_changing_selection", async () => {
    const { connected } = await mount();

    connected.rail.select(connected.rail.nodes[0]!.id);
    const selected = connected.rail.selected();
    const input = await openField();

    expect(connected.rail.selected()).toBe(selected);
    expect(leaderArmed()).toBe(false);
    expect(input.value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("u3713_help_and_panel_list_the_key_from_the_table", async () => {
    await mount();
    armLeader(new KeyboardEvent("keydown", { code: "KeyK", metaKey: true }));
    expect(screen.getByRole("status").textContent).toContain("T  Capture");
    await openField();
    fireEvent.keyDown(field()!, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(field()).toBeNull());
    const rail = document.body.appendChild(document.createElement("div"));

    rail.setAttribute("role", "tree");
    fireEvent.keyDown(rail, { key: "?", code: "Slash", shiftKey: true });
    await waitFor(() => expect(document.querySelector(".help")).not.toBeNull());
    expect(document.querySelector(".help")!.textContent).toContain("⌘K T  Capture a Todo");
    rail.remove();
  });

});

describe("u3714 enter files an Unassigned Todo", () => {
  it("u3714_enter_creates_one_unassigned_todo_shows_its_row_and_restores_focus", async () => {
    const { app, before } = await mount();
    const input = await openField();

    type(input, "  buy milk  ");
    press(input);

    expect(callsTo(app, "todo.create")).toHaveLength(1);
    expect(callsTo(app, "todo.create")[0]!.params).toEqual({ title: "buy milk", body: null, blockers: null });
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(before);
    await waitFor(() => expect(screen.getAllByText("buy milk")).toHaveLength(1));
  });

  it("u3714_blank_enter_calls_nothing", async () => {
    const { app } = await mount();
    const input = await openField();

    type(input, "   ");
    press(input);

    expect(callsTo(app, "todo.create")).toHaveLength(0);
    expect(field()).not.toBeNull();
  });

  it("u3714_escape_calls_nothing_and_restores_focus", async () => {
    const { app, before } = await mount();
    const input = await openField();

    type(input, "never filed");
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(field()).toBeNull());
    expect(callsTo(app, "todo.create")).toHaveLength(0);
    expect(document.activeElement).toBe(before);
  });

  it("u3714_the_row_shows_before_the_daemon_answers", async () => {
    const { app } = await mount();
    let answer!: () => void;
    app.handlers["todo.create"] = () => new Promise((resolve) => { answer = () => resolve(todo(9)); });
    const input = await openField();

    type(input, "pending thought");
    press(input);

    expect(screen.getByText("pending thought")).not.toBeNull();
    answer();
  });
});

describe("u3715 a failed create keeps the text and says why", () => {
  it("u3715_a_rejected_create_reopens_the_field_with_the_text_and_the_cause", async () => {
    const { app } = await mount();
    app.handlers["todo.create"] = () => Promise.reject(new RpcError(1, "the Daemon is full"));
    const input = await openField();

    type(input, "  keep me  ");
    press(input);

    await waitFor(() => expect(field()?.value).toBe("  keep me  "));
    expect(screen.getByRole("alert").textContent).toContain("the Daemon is full");
    expect(screen.queryByText("keep me", { selector: ".shelf *" })).toBeNull();
  });

  it("u3715_text_typed_during_a_pending_create_survives_its_rejection", async () => {
    const { app } = await mount();
    let fail!: () => void;
    app.handlers["todo.create"] = () => new Promise((_, reject) => { fail = () => reject(new RpcError(1, "nope")); });
    const input = await openField();

    type(input, "first");
    press(input, { shiftKey: true });
    type(field()!, "second");
    fail();

    await screen.findByRole("button", { name: "Use failed text" });
    expect(field()!.value).toBe("second");
    fireEvent.click(screen.getByRole("button", { name: "Use failed text" }));
    expect(field()!.value).toBe("first");
  });
});

describe("u3716 shift enter files and keeps the field open", () => {
  it("u3716_shift_enter_files_and_leaves_an_empty_focused_field", async () => {
    const { app } = await mount();
    const input = await openField();

    type(input, "one");
    press(input, { shiftKey: true });

    expect(callsTo(app, "todo.create")).toHaveLength(1);
    expect(field()!.value).toBe("");
    expect(document.activeElement).toBe(field());
  });

  it("u3716_a_failed_shift_enter_restores_the_text", async () => {
    const { app } = await mount();
    app.handlers["todo.create"] = () => Promise.reject(new RpcError(1, "no"));
    const input = await openField();

    type(input, "again");
    press(input, { shiftKey: true });

    await waitFor(() => expect(field()!.value).toBe("again"));
  });
});
