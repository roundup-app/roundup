import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import { todo } from "../../todos/testHarness";
import type { Todo } from "@contracts/todo/Todo";
import type { Pad } from "@contracts/pad/Pad";
import { agent, workstream, event } from "../../testing/nodes";
import { padHandlers, todoHandlers } from "../../testing/stores";
import { path, renderTabs, tab } from "../../header/stripFixture";

afterEach(cleanup);

const by = (id: string): Actor => ({ kind: "agent", id, parent: null });

const padOf = (name: string, who: Actor): Pad => ({ incarnation: `fixture-${name}`, name, owner: who, text: "", updated_at: 0, revision: 1, home: null });

const TREE = [agent("a1", "working", "x", { name: "auth" }), agent("a2", "working", "x", { name: "docs", order: 1 })];

/** The App on one Project whose Daemon holds `pads`; the Shelf starts closed. */
const mount = async (pads: Pad[], todos: Todo[] = [], tree = TREE) => {
  const { app } = renderTabs({ p: tree });
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
    await waitFor(() => expect(group("a1")?.querySelector(".shelf-group-control")).toBe(document.activeElement));
    expect(group("a1")?.getAttribute("aria-expanded")).toBe("true");
    expect(within(group("a1")!).getByRole("button", { name: pad.name })).toBeTruthy();

    fireEvent.click(control("a1")!);
    await waitFor(() => expect(document.activeElement).toBe(group("a1")?.querySelector(".shelf-group-control")));
  });

  it("u4457_the_control_switches_a_shelf_open_on_another_tab", async () => {
    await mount([padOf("notes", by("a1"))]);
    await waitFor(() => expect(control("a1")).not.toBeNull());

    fireEvent.click(control("a1")!);
    await waitFor(() => expect(group("a1")?.querySelector(".shelf-group-control")).toBe(document.activeElement));
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
    await waitFor(() => expect(within(group("unassigned")!).getByRole("button", { name: /^(?:Idle|Blocked|Done) #\d+ unassigned work/ })).toBe(document.activeElement));
    expect(group("unassigned")?.getAttribute("aria-expanded")).toBe("true");
    expect(group("a2")?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #\d+ finished work/ })).toBeTruthy();
    expect(document.querySelector('[role=tree] [data-id="a2"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("u4457_a_todo_only_control_reopens_the_folded_group", async () => {
    await mount([], [todo(1, { title: "work", creator: by("a1") })]);
    await waitFor(() => expect(control("a1")).not.toBeNull());
    fireEvent.click(control("a1")!);
    await waitFor(() => expect(within(group("unassigned")!).getByRole("button", { name: /Idle #1 work/ })).toBe(document.activeElement));
    fireEvent.click(group("unassigned")!.querySelector(".shelf-group-control")!);
    await waitFor(() => expect(group("unassigned")?.getAttribute("aria-expanded")).toBe("false"));
    fireEvent.click(control("a1")!);
    await waitFor(() => expect(within(group("unassigned")!).getByRole("button", { name: /Idle #1 work/ })).toBe(document.activeElement));
  });

  it("u4457_a_control_counting_only_finished_todos_opens_and_focuses_them", async () => {
    await mount([], [todo(1, { title: "finished work", creator: by("a1"), done: true })]);
    await waitFor(() => expect(control("a1")).not.toBeNull());
    fireEvent.click(control("a1")!);
    await waitFor(() => expect(screen.getByRole("button", { name: /Done #1 finished work/ })).toBe(document.activeElement));
  });

  it("u4457_the_control_keeps_its_count_and_name", async () => {
    await mount([padOf("notes", by("a1")), padOf("plan", by("a1"))]);
    await waitFor(() => expect(control("a1")?.getAttribute("aria-label")).toBe("2 pads"));

    expect(control("a2")).toBeNull();
  });
});

it.each(["v", "a2"])("u4457_reveals_first_home_group_through_folded_ancestors %s", async selected => {
  await mount([
    { ...padOf("first", by("a1")), home: "w" },
    { ...padOf("second", by("a1")), home: "v" },
    { ...padOf("other", by("a2")), home: "v" },
  ], [], [workstream("w"), agent("a1", "working", "x", { parent: "w", name: "auth" }), workstream("v", { order: 1 }), agent("a2", "working", "x", { parent: "v", name: "docs" })]);
  await waitFor(() => expect(control("a1")).not.toBeNull());
  fireEvent.click(document.querySelector<HTMLElement>(`[data-id="${selected}"] .name`)!);
  await waitFor(() => expect(document.activeElement?.closest("[data-id]")?.getAttribute("data-id")).toBe(selected));
  fireEvent.click(control("a1")!);
  await waitFor(() => expect(document.activeElement).toBe(group("w:a1")?.querySelector(".shelf-group-control")));
  fireEvent.click(group("w:a1")!.querySelector(".shelf-group-control")!);
  fireEvent.click(group("w")!.querySelector(".shelf-group-control")!);
  await waitFor(() => expect(group("w")?.getAttribute("aria-expanded")).toBe("false"));
  const before = rows();

  fireEvent.click(control("a1")!);
  await waitFor(() => expect(group("w")?.getAttribute("aria-expanded")).toBe("true"));
  await waitFor(() => expect(document.activeElement).toBe(group("w:a1")?.querySelector(".shelf-group-control")));
  expect([...document.querySelectorAll(".pads-tab [data-pad]")].map(row => row.getAttribute("data-pad"))).toEqual(["first", "second", "other"]);
  expect(Number(screen.getByRole("tab", { name: /Pads/ }).querySelector(".shelf-count")?.textContent)).toBe(3);
  expect(rows()).toEqual(before);
  expect(document.querySelector(`[data-id="${selected}"][data-selected="true"]`)).toBeTruthy();
});

it("u2744a_pads_stay_in_their_project", async () => {
  const { app } = renderTabs({ p: TREE, q: [agent("q1", "working", "x")] });

  for (const name of ["p", "q"]) {
    const daemon = app.of(path(name));
    Object.assign(daemon.handlers, padHandlers({ pads: [padOf(`${name}-notes`, by(name === "p" ? "a1" : "q1"))], history: [] }, data => daemon.emit(event(data))));
  }

  await screen.findByRole("tablist", { name: "Projects" });
  fireEvent.click(tab("p"));
  await waitFor(() => expect(tab("p").getAttribute("aria-selected")).toBe("true"));
  await waitFor(() => expect(control("a1")).not.toBeNull());
  fireEvent.click(control("a1")!);
  await waitFor(() => expect(document.querySelector('.pads-tab [data-pad="p-notes"]')).toBeTruthy());
  fireEvent.click(tab("q"));
  await waitFor(() => expect(control("q1")).not.toBeNull());
  fireEvent.click(control("q1")!);
  await waitFor(() => expect([...document.querySelectorAll('.pads-tab [data-pad]')].map(row => row.getAttribute("data-pad"))).toEqual(["q-notes"]));
  fireEvent.click(tab("p"));
  await waitFor(() => expect([...document.querySelectorAll('.pads-tab [data-pad]')].map(row => row.getAttribute("data-pad"))).toEqual(["p-notes"]));
});
