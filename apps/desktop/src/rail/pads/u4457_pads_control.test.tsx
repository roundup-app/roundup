import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import { todo } from "../../todos/testHarness";
import type { Todo } from "@contracts/todo/Todo";
import type { Pad } from "@contracts/pad/Pad";
import { agent, event } from "../../testing/nodes";
import { padHandlers, todoHandlers } from "../../testing/stores";
import { path, renderTabs } from "../../header/stripFixture";

afterEach(cleanup);

const by = (id: string): Actor => ({ kind: "agent", id, parent: null });

const padOf = (name: string, who: Actor): Pad => ({ incarnation: `fixture-${name}`, name, owner: who, text: "", updated_at: 0, revision: 1, home: null });

const TREE = [agent("a1", "working", "x", { name: "auth" }), agent("a2", "working", "x", { name: "docs", order: 1 })];

/** The App on one Project whose Daemon holds `pads`; the Shelf starts closed. */
const mount = async (pads: Pad[], todos: Todo[] = []) => {
  const { app } = renderTabs({ p: TREE });
  const daemon = app.of(path("p"));

  Object.assign(daemon.handlers, todoHandlers({ todos }, data => daemon.emit(event(data))));
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, data => daemon.emit(event(data))));
  await waitFor(() => expect(document.querySelector("[role=tree] [data-id]")).not.toBeNull());
};

const control = (id: string) => document.querySelector<HTMLElement>(`[role=treeitem][data-id="${id}"] [data-pads-control]`);

const group = (id: string) => document.querySelector<HTMLElement>(`[data-shelf-group="${id}"]`);

const rows = () => [...document.querySelectorAll("[role=tree] :is([data-part=item], [data-part=branch-control])[data-id]")].map(row => row.getAttribute("data-id"));

describe("u4457 the Pads control opens the Shelf", () => {
  it("u4457_the_control_opens_the_shelf_on_pads_with_the_agents_group_expanded_and_focused", async () => {
    const pad = padOf("notes", by("a1"));
    await mount([pad, padOf("plan", by("a2"))]);
    await waitFor(() => expect(control("a1")).not.toBeNull());

    fireEvent.click(document.querySelector<HTMLElement>('[role=treeitem][data-id="a1"] .name')!);
    await waitFor(() => expect(document.querySelector('[role=tree] [data-id="a1"]')?.getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(control("a1")!);

    await waitFor(() => expect(screen.getByRole("tab", { name: /Pads/, selected: true })).toBeTruthy());
    await waitFor(() => expect(within(group("a1")!).getByRole("button", { name: pad.name })).toBe(document.activeElement));
    expect(group("a1")?.getAttribute("aria-expanded")).toBe("true");
    expect(within(group("a1")!).getByRole("button", { name: pad.name })).toBeTruthy();

    fireEvent.click(control("a1")!);
    expect(document.activeElement).toBe(within(group("a1")!).getByRole("button", { name: pad.name }));
  });

  it("u4457_the_control_switches_a_shelf_open_on_another_tab", async () => {
    await mount([padOf("notes", by("a1"))]);
    await waitFor(() => expect(control("a1")).not.toBeNull());

    fireEvent.click(control("a1")!);
    await waitFor(() => expect(group("a1")).not.toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: /Todos/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Todos/, selected: true })).toBeTruthy());
    fireEvent.click(control("a1")!);

    await waitFor(() => expect(screen.getByRole("tab", { name: /Pads/, selected: true })).toBeTruthy());
    await waitFor(() => expect(group("a1")).not.toBeNull());
  });

  it("u4457_the_control_adds_no_rail_row_and_leaves_selection_and_order", async () => {
    await mount([padOf("notes", by("a1"))]);
    await waitFor(() => expect(control("a1")).not.toBeNull());

    fireEvent.click(document.querySelector<HTMLElement>('[role=treeitem][data-id="a2"] .name')!);
    await waitFor(() => expect(document.querySelector('[role=tree] [data-id="a2"]')?.getAttribute("aria-selected")).toBe("true"));
    const before = rows();

    fireEvent.click(control("a1")!);
    await waitFor(() => expect(group("a1")).not.toBeNull());

    expect(rows()).toEqual(before);
    expect(document.querySelector('[role=tree] [data-id="a2"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("u4457_no_rail_row_renders_a_pad_or_a_todo", async () => {
    await mount([padOf("notes", by("a1"))]);
    await waitFor(() => expect(control("a1")).not.toBeNull());

    const rail = within(screen.getByRole("tree", { name: "Rail" }));

    fireEvent.keyDown(rail.getByRole("treeitem", { name: /auth/ }), { key: "ArrowRight" });
    expect(rail.queryAllByRole("button").filter(button => button.closest("[data-pad], [data-todo]"))).toEqual([]);
    expect(document.querySelector(".rail-leaf")).toBeNull();
  });

  it("u4457_a_todo_only_control_reveals_the_todos_it_counts_in_their_owner_groups", async () => {
    await mount([], [
      todo(1, { title: "unassigned work", creator: by("a1") }),
      todo(2, { title: "delegated work", creator: by("a1"), owner: by("a2") }),
      todo(3, { title: "finished work", creator: by("a1"), done: true }),
    ]);
    await waitFor(() => expect(control("a1")?.getAttribute("aria-label")).toBe("3 todos"));
    fireEvent.click(document.querySelector<HTMLElement>('[role=treeitem][data-id="a2"] .name')!);
    await waitFor(() => expect(document.querySelector('[role=tree] [data-id="a2"]')?.getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(control("a1")!);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Todos/, selected: true })).toBeTruthy());
    await waitFor(() => expect(within(group("unassigned")!).getByRole("button", { name: /unassigned work/ })).toBe(document.activeElement));
    expect(group("unassigned")?.getAttribute("aria-expanded")).toBe("true");
    expect(group("a2")?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /finished work/ })).toBeTruthy();
    expect(document.querySelector('[role=tree] [data-id="a2"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("u4457_the_control_keeps_its_count_and_name", async () => {
    await mount([padOf("notes", by("a1")), padOf("plan", by("a1"))]);
    await waitFor(() => expect(control("a1")?.getAttribute("aria-label")).toBe("2 pads"));

    expect(control("a2")).toBeNull();
  });
});
