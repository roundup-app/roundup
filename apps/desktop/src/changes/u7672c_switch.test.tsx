import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { agent } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { COMPARISON, treeRow } from "./noteHarness";

afterEach(cleanup);

const tree = (name: string) => ({ worktree: { path: `/w/${name}`, branch: `own/${name}`, base: "main", adopted: false } });

const OWNED: OwnedChanges = { groups: [
  { repo: "/p", branch: "main", base: "main", files: [{ path: "own.ts", status: "modified", line: 1, counts: { added: 1, removed: 0 }, blob: null }] },
  { repo: "/q", branch: "own/x", base: "main", files: [{ path: "other.ts", status: "added", line: 1, counts: { added: 2, removed: 0 }, blob: null }] },
] };

const LISTS = { tree: ["tree.ts", "loose.ts"], branch: ["branch.ts"] } as const;

const open = async (nodes = [agent("a", "idle", "ready", tree("a")), agent("b", "idle", "ready", tree("b"))]) => {
  const mounted = await mountRail(nodes, [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => OWNED;
    // SAFETY: the handler is only reached with the two non-Changes targets, the keys of LISTS.
    app.handlers["agent.changedFiles"] = ({ to }) => ({ files: LISTS[to as "tree" | "branch"].map(path => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 1 }, blob: null })) });
    app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  });

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "2 changed files" }));
  await screen.findByRole("region", { name: "Changes" });

  return mounted;
};

const selected = () => screen.getByRole("radio", { checked: true }).getAttribute("aria-label");

const rowText = (row: HTMLElement) => row.textContent ?? "";

const groupLists = () => screen.queryAllByRole("list", { name: "Repositories and branches" });

const files = () => [...document.querySelector("file-tree-container")?.shadowRoot?.querySelectorAll("[data-item-type=file]") ?? []];

it("u7672c_from_is_a_label_not_a_control", async () => {
  await open();

  const from = await screen.findByText("remote main", { selector: ".changes-from" });

  expect(from.tagName).toBe("SPAN");
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
});

it("u7672c_the_switch_has_three_values_and_opens_on_changes", async () => {
  await open();

  const values = await screen.findAllByRole("radio");

  expect(values.map(value => value.getAttribute("aria-label"))).toEqual(["Tree", "Branch", "Changes"]);
  expect(selected()).toBe("Changes");
});

it("u7672c_choosing_a_value_lists_that_values_files", async () => {
  const { app } = await open();

  await treeRow("own.ts");
  fireEvent.click(screen.getByRole("radio", { name: "Branch" }));
  await treeRow("branch.ts");
  expect(app.calls.filter(call => call.method === "agent.changedFiles").map(call => call.params)).toEqual([{ id: "a", to: "branch" }]);
  fireEvent.click(screen.getByRole("radio", { name: "Tree" }));
  await treeRow("tree.ts");
  fireEvent.click(await treeRow("tree.ts"));
  await waitFor(() => expect(app.calls.some(call => call.method === "agent.compareFile")).toBe(true));
  expect(app.calls.find(call => call.method === "agent.compareFile")?.params).toEqual({ id: "a", path: "tree.ts", to: "tree" });
  fireEvent.click(screen.getByRole("radio", { name: "Changes" }));
  await treeRow("own.ts");
  await waitFor(() => expect(files().length).toBe(1));
});

it("u7672c_a_shared_checkout_offers_changes_alone", async () => {
  const { app } = await open([agent("a", "idle", "ready")]);

  await treeRow("own.ts");
  expect(app.calls.filter(call => call.method === "agent.changedFiles")).toEqual([]);
  // A one-value switch would change nothing when pressed, so the header draws no control for it.
  expect(screen.queryAllByRole("radiogroup")).toHaveLength(0);
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
});

it("u7672c_tree_and_branch_show_one_group", async () => {
  await open();

  await screen.findByRole("list", { name: "Repositories and branches" });
  fireEvent.click(screen.getByRole("radio", { name: "Tree" }));
  await treeRow("tree.ts");
  expect(groupLists().map(list => list.id)).toEqual([]);
});

it("u7672c_the_switch_is_reachable_and_arrow_keys_move_it", async () => {
  await open();

  const changes = await screen.findByRole("radio", { name: "Changes" });

  changes.focus();
  fireEvent.keyDown(changes, { key: "ArrowLeft" });
  await waitFor(() => expect(selected()).toBe("Branch"));
});

it("u7672c_no_compare_refs_call_and_no_from", async () => {
  const { app } = await open();

  fireEvent.click(await screen.findByRole("radio", { name: "Tree" }));
  fireEvent.click(await treeRow("tree.ts"));
  await waitFor(() => expect(app.calls.some(call => call.method === "agent.compareFile")).toBe(true));
  const methods: string[] = app.calls.map(call => call.method);
  // SAFETY: every agent.c* call carries an object of params.
  const sentKeys = app.calls.flatMap(call => (call.method.startsWith("agent.c") ? Object.keys(call.params as object) : []));

  expect(methods).not.toContain("project.compareRefs");
  expect(sentKeys).not.toContain("from");
});

it("u7672d_one_agents_choice_never_changes_another", async () => {
  await open();

  fireEvent.click(await screen.findByRole("radio", { name: "Branch" }));
  await treeRow("branch.ts");
  fireEvent.click(rowOf("b"));
  await screen.findByText("b", { selector: ".changes-name" });
  expect(selected()).toBe("Changes");
  fireEvent.click(rowOf("a"));
  await screen.findByText("a", { selector: ".changes-name" });
  expect(selected()).toBe("Branch");
});

it("u7672d_rows_and_reader_keep_their_rules_for_every_value", async () => {
  const { app } = await open();

  fireEvent.click(await screen.findByRole("radio", { name: "Tree" }));
  const row = await treeRow("tree.ts");

  expect(rowText(row)).toMatch(/\+3.*-1/);
  expect(app.calls.filter(call => call.method === "agent.compareFile")).toEqual([]);
  expect(files().length).toBe(2);
});

it("u7672d_the_choice_is_remembered_and_falls_back_without_a_worktree", async () => {
  await open();

  fireEvent.click(await screen.findByRole("radio", { name: "Branch" }));
  await treeRow("branch.ts");
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "2 changed files" }));
  await treeRow("branch.ts");
  expect(selected()).toBe("Branch");
});
