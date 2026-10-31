import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { agent, workstream } from "../testing/nodes";
import { createFakeApp } from "../testing/fakeApp";
import { showEverything, withScopeRow } from "../testing/showEverything";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { Capture } from "../todos/Capture";
import { Todos } from "../todos/Todos";
import { todo, todoCallsTo as callsTo } from "../todos/testHarness";
import { Help } from "./Help";
import { pressOf } from "./chords";
import { copy } from "./copy";

afterEach(cleanup);

const mount = async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow([workstream("w", { name: "Docs" }), agent("a", "idle", "idle", { name: "Ada", parent: "w" }), agent("b", "idle", "idle", { name: "Bo" })]);

  const store: TodoStore = { todos: [] };
  Object.assign(app.handlers, todoHandlers(store, () => {}));

  const connected = await connectProject(app, { name: "p", path: `/test-chord/${crypto.randomUUID()}` }, () => true, () => 0);

  await showEverything(connected);
  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <button data-testid="before">before</button>
      <div role="tree" tabIndex={0} data-testid="rail" />
      <textarea class="xterm-helper-textarea" data-testid="terminal" />
      <Todos />
      <Capture onFile={undefined} />
      <Help />
    </ConnectedProjectContext.Provider>
  ));

  return { app, connected, store };
};

const field = (): HTMLTextAreaElement | null => screen.queryByRole<HTMLTextAreaElement>("textbox", { name: "Capture a Todo" });

const chord = (target: Element) => fireEvent.keyDown(target, { code: "KeyT", key: "T", metaKey: true, shiftKey: true });

const press = (input: HTMLElement, init: KeyboardEventInit = {}) => fireEvent.keyDown(input, { key: "Enter", code: "Enter", ...init });

// Rule 10: u3713_leader_t_opens_a_focused_empty_field_without_changing_selection proves the removed leader alias test; the design critic owns help copy.
// u3746_a_retry_after_a_refused_move_moves_the_created_todo_and_creates_none also proves the removed standalone refused-move retention observer.
describe("u3737 the chord opens the capture field", () => {
  it("u3737_the_chord_opens_a_focused_empty_field_from_each_surface_without_changing_selection", async () => {
    const { connected } = await mount();

    connected.rail.select("a");

    for (const id of ["before", "rail", "terminal"]) {
      const from = screen.getByTestId(id);

      from.focus();
      const press = new KeyboardEvent("keydown", { code: "KeyT", key: "T", metaKey: true, shiftKey: true, bubbles: true, cancelable: true });


      from.dispatchEvent(press);

      const input = await waitFor(() => {
        expect(field()).not.toBeNull();

        return field()!;
      });

      expect(press.defaultPrevented).toBe(true);
      expect(input.value).toBe("");
      expect(connected.rail.selected()).toBe("a");
      await waitFor(() => expect(document.activeElement).toBe(input));
      chord(input);
      expect(screen.getAllByRole("textbox", { name: "Capture a Todo" })).toHaveLength(1);
      fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
      await waitFor(() => expect(field()).toBeNull());
      expect(document.activeElement).toBe(from);
    }
  });

  it("u3737_the_chord_does_nothing_under_a_modal_layer", async () => {
    await mount();
    const rail = screen.getByTestId("rail");

    rail.focus();
    fireEvent.keyDown(rail, { key: "?", code: "Slash", shiftKey: true });
    await waitFor(() => expect(document.querySelector(".help")).not.toBeNull());
    chord(document.activeElement ?? rail);
    expect(field()).toBeNull();
  });

});

it("u3738_the_chord_writes_nothing_to_the_terminal_and_focus_returns_on_escape", async () => {
  const { app } = await mount();
  const terminal = screen.getByTestId("terminal");

  const reached: string[] = [];

  terminal.addEventListener("keydown", (event) => reached.push(pressOf(event)));
  terminal.focus();

  chord(terminal);

  const input = await waitFor(() => {
    expect(field()).not.toBeNull();

    return field()!;
  });

  fireEvent.keyDown(input, { key: "x", code: "KeyX" });
  expect(reached).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
  fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(terminal));
});

describe("u3740 the field shows the Owner and Home", () => {
  const open = async (selected: string | null) => {
    const made = await mount();

    if (selected !== null) made.connected.rail.select(selected);
    chord(screen.getByTestId("before"));
    await waitFor(() => expect(field()).not.toBeNull());

    return made;
  };

  // Rule 10: filing contracts replace the removed exact target-line copy observers and standalone enter observer.
  it("u3740_each_selection_files_for_its_owner_and_home", async () => {
    for (const [selected, owner, home] of [["a", "a", "w"], ["b", "b", null], ["w", null, "w"], ["overview", null, null]] as const) {
      const { app } = await open(selected);
      fireEvent.input(field()!, { target: { value: "ship it" } });
      press(field()!);
      await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(1));
      const creation = { title: "ship it", body: null, blockers: null };
      expect(callsTo(app, "todo.create")[0]!.params).toEqual(owner ? { ...creation, owner: { kind: "agent", id: owner, parent: null } } : creation);

      if (home) await waitFor(() => expect(callsTo(app, "todo.move")[0]?.params).toMatchObject({ home }));
      else expect(callsTo(app, "todo.move")).toEqual([]);
      cleanup();
    }
  });

  it("u3740_selection_change_while_open_changes_the_filed_recipient", async () => {
    const { app, connected } = await open("a");
    connected.rail.select("b");
    fireEvent.input(field()!, { target: { value: "ship it" } });
    press(field()!);
    await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(1));
    expect(callsTo(app, "todo.create")[0]?.params).toMatchObject({ owner: { kind: "agent", id: "b", parent: null } });
  });

  it("u3746_a_retry_after_a_refused_move_moves_the_created_todo_and_creates_none", async () => {
    const { app } = await open("w");
    let refuse = true;

    app.handlers["todo.create"] = () => Promise.resolve(todo(5));
    app.handlers["todo.move"] = () => refuse ? Promise.reject(new RpcError(-32001, "no such Workstream")) : Promise.resolve(todo(5));
    fireEvent.input(field()!, { target: { value: "stay" } });
    press(field()!);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(field()?.value).toBe("stay");
    refuse = false;
    press(field()!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo(app, "todo.create")).toHaveLength(1);
    expect(callsTo(app, "todo.move")).toHaveLength(2);
  });

  it("u3746_an_edited_retry_files_a_new_todo", async () => {
    const { app } = await open("w");
    let refuse = true;

    app.handlers["todo.create"] = () => Promise.resolve(todo(5));
    app.handlers["todo.move"] = () => refuse ? Promise.reject(new RpcError(-32001, "no such Workstream")) : Promise.resolve(todo(5));
    fireEvent.input(field()!, { target: { value: "stay" } });
    press(field()!);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    refuse = false;
    fireEvent.input(field()!, { target: { value: "stay more" } });
    press(field()!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo(app, "todo.create")).toHaveLength(2);
  });
});

describe("u5171 Help names the arrows", () => {
  it("u5171_help_names_left_and_right_for_rows", async () => {
    await mount();

    fireEvent.keyDown(screen.getByTestId("rail"), { key: "?", shiftKey: true });

    const panel = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".help");

      expect(found).not.toBeNull();

      return found!;
    });

    expect(within(panel).queryAllByText(copy.collapseExpand)).toHaveLength(1);
  });
});
