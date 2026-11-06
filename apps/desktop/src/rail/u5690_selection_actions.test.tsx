import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { menuProbe, questionProbe } from "../testing/menuProbe";
import { mountRail, rowOf, railCallsTo } from "./railFixture";

afterEach(cleanup);

const nodes = () => ["a", "b", "c", "d", "e"].map((id, order) => agent(id, "done", "", { terminal_id: null, order }));

const selected = () => [...document.querySelectorAll<HTMLElement>('.rail-row[data-selected=true]')].map(row => row.dataset.id);

const select = (...ids: string[]) => { for (const id of ids) fireEvent.click(rowOf(id), { metaKey: true }); };

it("u5690a_context_click_uses_the_selected_set_or_replaces_it", async () => {
  const { app, rail } = await mountRail(nodes());
  select("a", "c");
  fireEvent.contextMenu(rowOf("a"));
  expect(selected()).toEqual(["a", "c"]);
  await app.closeMenu();
  fireEvent.contextMenu(rowOf("d"));
  expect(selected()).toEqual(["d"]);
  expect(rail.selected()).toBeNull();
  await app.closeMenu();
  expect(app.calls.filter(call => /spawn|resume|stop|remove|group/.test(call.method))).toEqual([]);
});

it("u5690b_selection_menu_has_group_then_remove_all", async () => {
  const { app } = await mountRail(nodes());
  select("e", "a", "c");
  fireEvent.contextMenu(rowOf("c"));
  expect(menuProbe.shown?.map(item => item.id)).toEqual(["group", "remove-selection"]);
  expect(menuProbe.shown?.[1]?.shortcut).toBe("⇧⌘⌫");
  await app.closeMenu();
});

it.each(["menu", "key"])("u5690d_remove_menu_and_chord_share_one_selection_question_%s", async entry => {
  const { app, rail } = await mountRail(nodes());
  select("e", "c", "a");
  expect(rail.selected()).toBeNull();

  if (entry === "menu") { fireEvent.contextMenu(rowOf("c")); await app.pickMenu("Remove all"); }
  else fireEvent.keyDown(rowOf("a"), { key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true });
  await waitFor(() => expect(questionProbe.shown).not.toBeNull());
  expect(questionProbe.shown?.message).toContain("a\nc\ne");
  expect(railCallsTo(app, "rail.removeSelection")).toEqual([]);
  questionProbe.answer?.(false);
  await waitFor(() => expect(questionProbe.shown).toBeNull());
  expect(selected()).toEqual(["a", "c", "e"]);
});

it.each([
  { ids: ["b", "c"], next: "d" },
  { ids: ["d", "e"], next: "c" },
  { ids: ["a", "c", "e"], next: "d" },
  { ids: ["a", "b", "c", "d", "e"], next: null },
])("u5690d_selection_chord_uses_collection_and_advances_once_$ids", async ({ ids, next }) => {
  const tree = nodes();
  const { app, rail, connected } = await mountRail(tree);
  let finish: ((value: import("@contracts/agent/Removal").Removal) => void) | undefined;
  app.handlers["rail.removeSelection"] = () => new Promise(resolve => { finish = resolve; });
  select(...ids);
  const target = rowOf(ids[0]!);
  target.focus();
  const key = { key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true };
  fireEvent.keyDown(target, key);
  await waitFor(() => expect(questionProbe.shown).not.toBeNull());
  fireEvent.keyDown(target, { ...key, repeat: true });
  fireEvent.keyDown(target, key);
  expect(app.questions).toHaveLength(1);
  questionProbe.answer?.(true);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.keyDown(target, key);
  expect(railCallsTo(app, "rail.removeSelection")).toEqual([{ ids: [...ids].sort(), operation: expect.any(String) }]);
  app.handlers["rail.tree"] = () => tree.filter(node => !ids.includes(node.id));
  finish!({ removed: [], kept: [], selection: ids, deletion: { id: ids[0]!, project: "p", operation: "selected-removal", restored: false } });
  await waitFor(() => expect(rail.selected()).toBe(next));
  await waitFor(() => expect(selected()).toEqual(next ? [next] : []));

  if (next) await waitFor(() => expect(document.activeElement).toBe(rowOf(next)));
  else await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".rail-tree")));
  await waitFor(() => expect(connected.drafts.todoUndo.available("rail")).toBe(true));
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it("u5690d_mixed_losses_are_named_once_and_consent_uses_default_scopes", async () => {
  const tree = nodes();
  tree[0]!.worktree = { path: "/p/a", branch: "a", base: "main" };
  tree[2]!.terminal_id = "t-c";
  const { app, connected } = await mountRail(tree);
  select("e", "c", "a");
  app.handlers["rail.removeSelection"] = () => ({ removed: [], kept: [] });
  fireEvent.contextMenu(rowOf("c"));
  await app.pickMenu("Remove all");
  await waitFor(() => expect(questionProbe.shown).not.toBeNull());
  expect(questionProbe.shown?.message).toContain("a\nc\ne");
  expect(questionProbe.shown?.message).toMatch(/Worktree for a/);
  expect(questionProbe.shown?.message).toMatch(/program for c/);
  expect(railCallsTo(app, "rail.removeSelection")).toEqual([]);
  questionProbe.answer?.(true);
  await waitFor(() => expect(railCallsTo(app, "rail.removeSelection")).toEqual([{ ids: ["a", "c", "e"] }]));
  expect(connected.drafts.todoUndo.available("rail")).toBe(false);
});

it.each(["Enter", "Escape"])("u5690c_group_collects_in_rail_order_and_focuses_rename_%s", async key => {
  const tree = nodes();
  const { app, rail } = await mountRail(tree);
  app.handlers["rail.group"] = () => {
    const group = { ...tree[0]!, kind: "group" as const, id: "group", name: "Group", status: null };

    for (const node of tree.filter(node => ["a", "c", "e"].includes(node.id))) node.parent = group.id;
    tree.unshift(group);

    return group;
  };

  app.handlers["rail.rename"] = ({ name }) => { tree[0]!.name = name;

 return tree[0]!; };

  select("c", "a", "e");
  fireEvent.contextMenu(rowOf("a"));
  await app.pickMenu("Group");
  const input = await screen.findByRole("textbox", { name: "Name" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(rail.selected()).toBe("group");
  expect(railCallsTo(app, "rail.group")).toEqual([{ ids: ["a", "c", "e"] }]);
  fireEvent.input(input, { target: { value: "Organized" } });
  fireEvent.keyDown(input, { key });

  if (key === "Enter") await waitFor(() => expect(railCallsTo(app, "rail.rename")).toEqual([{ id: "group", name: "Organized" }]));
  else expect(railCallsTo(app, "rail.rename")).toEqual([]);
  await waitFor(() => expect(document.activeElement?.closest(".rail-row")?.getAttribute("data-id")).toBe("group"));
  expect(app.calls.filter(call => /spawn|resume|stop/.test(call.method))).toEqual([]);
});

it.each(["context", "control", "keyboard"])("u5690a_range_selection_and_outside_target_%s", async gesture => {
  const { app } = await mountRail(nodes());
  select("b");
  fireEvent.click(rowOf("d"), { shiftKey: true });
  expect(selected()).toEqual(["b", "c", "d"]);

  if (gesture === "keyboard") {
    rowOf("c").focus();
    fireEvent.keyDown(rowOf("c"), { key: "F10", code: "F10", shiftKey: true });
  } else {
    if (gesture === "control") fireEvent.pointerDown(rowOf("c"), { button: 0, ctrlKey: true });
    fireEvent.contextMenu(rowOf("c"), { ctrlKey: gesture === "control" });

    if (gesture === "control") fireEvent.click(rowOf("c"));
  }

  expect(app.shownMenus.at(-1)?.items.map(item => item.id)).toEqual(["group", "remove-selection"]);
  expect(selected()).toEqual(["b", "c", "d"]);
  await app.closeMenu();
  fireEvent.contextMenu(rowOf("e"));
  expect(selected()).toEqual(["e"]);
  expect(app.shownMenus.at(-1)?.items.map(item => item.id)).toContain("remove");
  await app.closeMenu();
});


it("u5690d_overlapping_selection_removes_each_identity_once", async () => {
  const { app } = await mountRail([workstream("w"), agent("child", "working", "", { parent: "w" }), agent("other", "done", "", { terminal_id: null })]);
  app.handlers["rail.removeSelection"] = () => ({ removed: [], kept: [] });
  select("child", "w");
  fireEvent.contextMenu(rowOf("w"));
  await app.pickMenu("Remove all");
  await waitFor(() => expect(questionProbe.shown).not.toBeNull());
  expect(questionProbe.shown?.message?.match(/program for child/g)).toHaveLength(1);
  expect(questionProbe.shown?.message).not.toMatch(/Stays:.*child/);
  questionProbe.answer?.(true);
  await waitFor(() => expect(railCallsTo(app, "rail.removeSelection")).toEqual([{ ids: ["w", "child"] }]));
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

it("u5690e_one_row_keeps_its_menu_and_removal_after_outside_click", async () => {
  const { app } = await mountRail(nodes());
  app.handlers["rail.remove"] = ({ id, operation }) => ({ removed: [], kept: [], deletion: { id, project: "p", operation: operation!, restored: false } });
  select("a", "c", "e");
  fireEvent.contextMenu(rowOf("b"));
  expect(selected()).toEqual(["b"]);
  expect(app.shownMenus.at(-1)?.items.map(item => item.id)).toContain("rename");
  expect(app.shownMenus.at(-1)?.items.map(item => item.id)).not.toContain("group");
  await app.pickMenu("Remove");
  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "b", operation: expect.any(String) }]));
  expect(app.questions).toEqual([]);
  expect(railCallsTo(app, "rail.removeSelection")).toEqual([]);
});
