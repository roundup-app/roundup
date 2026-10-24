import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream, door, MINUTE, NOW } from "../testing/nodes";
import { itemOf, rowOf, settled } from "../rail/railFixture";
import type { EmulatorFactory } from "../terminal/emulator";
import { mountKeys } from "./keysFixture";

afterEach(cleanup);

/** A terminal screen that is actually focusable, standing in for xterm's real helper textarea (as in `u31_rail_keyboard.test.tsx`). */
const focusableEmulator = (): EmulatorFactory => () => {
  const field = document.createElement("textarea");

  return {
    write: () => {},
    setSize: () => {},
    setFontSize: () => {},
    reset: () => {},
    selection: () => "",
    turns: () => [],
    selectTurn: () => {},
    onLink: () => {},
    paste: () => {},
    onInput: () => {},
    show: (host) => {
      host.replaceChildren(field);
      field.focus();

      return { cols: 80, rows: 24 };
    },
    fit: () => ({ cols: 80, rows: 24 }),
    focus: () => field.focus(),
    isAtBottom: () => true,
    onScroll: () => {},
    scrollToBottom: () => {},
    dispose: () => {},
  };
};

/** An emulator that marks its field with the Terminal `id` it was created for, so a test can tell which Terminal the pane shows. */
const terminalMarkerEmulator = (): EmulatorFactory => (id: string) => {
  const field = document.createElement("textarea");

  field.dataset.terminal = id;

  return {
    write: () => {},
    setSize: () => {},
    setFontSize: () => {},
    reset: () => {},
    selection: () => "",
    turns: () => [],
    selectTurn: () => {},
    onLink: () => {},
    paste: () => {},
    onInput: () => {},
    show: (host) => {
      host.replaceChildren(field);
      field.focus();

      return { cols: 80, rows: 24 };
    },
    fit: () => ({ cols: 80, rows: 24 }),
    focus: () => field.focus(),
    isAtBottom: () => true,
    onScroll: () => {},
    scrollToBottom: () => {},
    dispose: () => {},
  };
};

const press = (key: string, held: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement ?? document, { key, ...held });

describe("u41 rail by keyboard, the rest", () => {
  it("u41_left_on_an_expanded_group_collapses_it", async () => {
    await mountKeys([workstream("g"), agent("child", "idle", "x", { parent: "g" })]);
    rowOf("g").focus();

    press("ArrowLeft");

    await settled();

    expect(itemOf("g").getAttribute("aria-expanded")).toBe("false");
  });

  it("u41_left_on_an_expanded_group_among_several_collapses_only_the_focused_one", async () => {
    await mountKeys([workstream("g1", { order: 0 }), workstream("g2", { order: 1 })]);
    rowOf("g2").focus();

    press("ArrowLeft");

    await settled();

    expect(itemOf("g2").getAttribute("aria-expanded")).toBe("false");
    expect(itemOf("g1").getAttribute("aria-expanded")).toBe("true");
  });

  it("u41_left_on_a_collapsed_group_moves_to_its_parent", async () => {
    await mountKeys([workstream("outer"), workstream("inner", { parent: "outer" })]);
    fireEvent.click(within(rowOf("inner")).getByRole("button", { name: "Collapse" }));
    await settled();
    rowOf("inner").focus();

    press("ArrowLeft");

    await settled();

    expect(document.activeElement).toBe(rowOf("outer"));
  });

  it("u41_left_on_a_leaf_moves_to_its_parent", async () => {
    await mountKeys([workstream("g"), agent("child", "idle", "x", { parent: "g" })]);
    rowOf("child").focus();

    press("ArrowLeft");

    await settled();

    expect(document.activeElement).toBe(rowOf("g"));
  });

  it("u41_left_at_depth_three_moves_to_the_immediate_parent_not_the_root", async () => {
    await mountKeys([
      workstream("outer"),
      workstream("inner", { parent: "outer" }),
      agent("leaf", "idle", "x", { parent: "inner" }),
    ]);

    rowOf("leaf").focus();

    press("ArrowLeft");

    await settled();

    expect(document.activeElement).toBe(rowOf("inner"));
  });

  it("u41_left_on_a_top_level_leaf_does_nothing", async () => {
    const { rail } = await mountKeys([agent("a", "idle", "x")]);
    rowOf("a").focus();

    press("ArrowLeft");

    await settled();

    expect(rail.selected()).toBeNull();
    expect(document.activeElement).toBe(rowOf("a"));
  });

  it("u41_right_on_a_collapsed_group_expands_it", async () => {
    await mountKeys([workstream("g"), agent("child", "idle", "x", { parent: "g" })]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    await settled();
    rowOf("g").focus();

    press("ArrowRight");

    await settled();

    expect(itemOf("g").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id"))).toHaveLength(2);
  });

  it("u41_right_on_a_collapsed_group_among_several_expands_only_the_focused_one", async () => {
    await mountKeys([workstream("g1", { order: 0 }), workstream("g2", { order: 1 })]);
    fireEvent.click(within(rowOf("g1")).getByRole("button", { name: "Collapse" }));
    await settled();
    fireEvent.click(within(rowOf("g2")).getByRole("button", { name: "Collapse" }));
    await settled();
    rowOf("g2").focus();

    press("ArrowRight");

    await settled();

    expect(itemOf("g2").getAttribute("aria-expanded")).toBe("true");
    expect(itemOf("g1").getAttribute("aria-expanded")).toBe("false");
  });

  it("u41_right_on_an_expanded_group_moves_to_its_first_child", async () => {
    await mountKeys([
      workstream("g"),
      agent("b", "idle", "x", { parent: "g", order: 1 }),
      agent("a", "idle", "x", { parent: "g", order: 0 }),
    ]);

    rowOf("g").focus();

    press("ArrowRight");

    await settled();

    expect(document.activeElement).toBe(rowOf("a"));
  });

  it("u41_right_moves_to_the_first_visible_child_skipping_a_row_folded_into_done", async () => {
    await mountKeys([
      workstream("g"),
      agent("old", "done", "finished", { parent: "g", order: 0, status: { kind: "done", label: "finished", since: NOW - 11 * MINUTE, finished: "0" } }),
      agent("live", "idle", "x", { parent: "g", order: 1 }),
    ]);

    rowOf("g").focus();

    press("ArrowRight");

    await settled();

    expect(document.activeElement).toBe(rowOf("live"));
  });

  it("u41_right_on_an_expanded_door_moves_to_its_first_child", async () => {
    await mountKeys([door("m", "working", "x"), agent("a", "idle", "y", { parent: "m" })]);

    rowOf("m").focus();

    press("ArrowRight");

    await settled();

    expect(document.activeElement).toBe(rowOf("a"));
  });

  it("u41_left_on_an_expanded_door_collapses_its_workstream", async () => {
    const { rail } = await mountKeys([
      workstream("g"),
      door("m", "working", "x", { parent: "g" }),
      agent("child", "idle", "y", { parent: "m" }),
    ]);

    rowOf("m").focus();

    press("ArrowLeft");

    await settled();

    expect(rail.collapsed().has("m")).toBe(true);
    expect(document.activeElement).toBe(rowOf("m"));
    expect(screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id"))).toHaveLength(2);
  });

  it("u41_right_on_a_leaf_with_no_children_does_nothing", async () => {
    const { rail } = await mountKeys([agent("a", "idle", "x")]);
    rowOf("a").focus();

    press("ArrowRight");

    await settled();

    expect(rail.selected()).toBeNull();
    expect(document.activeElement).toBe(rowOf("a"));
  });

  it("u41_right_on_a_leaf_followed_by_a_sibling_does_not_select_the_sibling", async () => {
    const { rail } = await mountKeys([
      agent("a", "idle", "x", { order: 0 }),
      agent("b", "idle", "y", { order: 1 }),
    ]);

    rowOf("a").focus();

    press("ArrowRight");

    await settled();

    expect(rail.selected()).toBeNull();
    expect(document.activeElement).toBe(rowOf("a"));
  });

  it("u41_arrow_left_and_right_in_the_rail_prevent_the_default_action", async () => {
    await mountKeys([workstream("g")]);
    rowOf("g").focus();

    expect(press("ArrowLeft")).toBe(false);
    expect(press("ArrowRight")).toBe(false);
  });

  it.each<[string, KeyboardEventInit]>([
    ["ctrl", { ctrlKey: true }],
    ["alt", { altKey: true }],
    ["cmd", { metaKey: true }],
  ])("u41_arrow_left_with_a_modifier_does_nothing_%s", async (_, held) => {
    await mountKeys([workstream("g"), agent("child", "idle", "x", { parent: "g" })]);
    rowOf("g").focus();

    const notPrevented = press("ArrowLeft", held);

    await settled();

    expect(notPrevented).toBe(true);
    expect(itemOf("g").getAttribute("aria-expanded")).toBe("true");
  });

  it("u41_shift_f2_does_nothing", async () => {
    await mountKeys([agent("a", "idle", "x")]);
    rowOf("a").focus();

    press("F2", { shiftKey: true });

    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("u41_arrow_left_in_the_pane_reaches_the_terminal", async () => {
    const { rail } = await mountKeys(
      [workstream("g"), agent("a", "idle", "x", { parent: "g" })],
      { pane: focusableEmulator() },
    );

    rail.select("a");

    await settled();
    screen.getAllByRole("textbox")[0]!.focus();
    const field = document.activeElement;

    const notPrevented = press("ArrowLeft");

    await settled();

    expect(notPrevented).toBe(true);
    expect(rail.selected()).toBe("a");
    expect(document.activeElement).toBe(field);
  });

  it("u41_arrow_left_in_the_rename_field_does_not_cancel_it", async () => {
    await mountKeys([agent("a", "idle", "x")]);
    fireEvent.dblClick(screen.getByText("a"));
    const field = screen.getByLabelText("Name");
    field.focus();

    const notPrevented = press("ArrowLeft");

    await settled();

    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it("u41_f2_prevents_the_default_action", async () => {
    const { rail } = await mountKeys([agent("a", "idle", "x")]);
    rail.select("a");
    await settled();
    rowOf("a").focus();

    expect(press("F2")).toBe(false);
  });

  it("u41_a_plain_key_other_than_f2_does_not_open_rename", async () => {
    const { rail } = await mountKeys([agent("a", "idle", "x")]);
    rail.select("a");
    await settled();
    rowOf("a").focus();

    press("j");

    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("u41_f2_on_the_collapse_button_does_nothing", async () => {
    const { rail } = await mountKeys([workstream("g")]);
    rail.select("g");
    await settled();
    screen.getByRole("button", { name: "Collapse" }).focus();

    press("F2");

    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("u41_enter_on_the_row_right_moved_to_shows_its_terminal_exactly_as_a_click_does", async () => {
    await mountKeys(
      [workstream("g"), agent("child", "idle", "x", { parent: "g" })],
      { pane: terminalMarkerEmulator() },
    );
    rowOf("g").focus();

    press("ArrowRight");
    await settled();
    press("Enter");
    await settled();

    expect(document.querySelector<HTMLElement>(".pane-screen [data-terminal]")?.dataset.terminal).toBe("t-child");
  });

  it("u41_selecting_a_row_by_keyboard_calls_no_method_of_its_own", async () => {
    const { app } = await mountKeys([workstream("g"), agent("child", "idle", "x", { parent: "g" })]);
    rowOf("g").focus();
    const before = app.calls.length;

    press("ArrowRight");

    await settled();

    expect(app.calls.length).toBe(before);
  });

  it.each<[string, string]>([
    ["left", "ArrowLeft"],
    ["right", "ArrowRight"],
    ["f2", "F2"],
  ])("u41_%s_in_an_open_drawer_does_nothing", async (_, key) => {
    const { rail, connected } = await mountKeys(
      [workstream("g"), agent("child", "idle", "x", { parent: "g" })],
      { drawer: true },
    );

    rowOf("g").focus();
    connected.drawer.open(() => <input aria-label="field" />);
    screen.getByLabelText("field").focus();

    const notPrevented = press(key);

    await settled();

    expect(notPrevented).toBe(true);
    expect(rail.selected()).toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});
