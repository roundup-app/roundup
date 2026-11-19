import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, mode, workstream } from "../testing/nodes";
import { railStorage } from "../state/railStorage";
import { mountRail, rowNames, rowOf } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const press = (name: string) => fireEvent.click(within(rowOf(name)).getByRole("button", { name: /^(Collapse|Expand)/ }));

it.each([
  ["Workstream", () => [workstream("fold"), agent("a", "idle", "", { parent: "fold" }), agent("b", "working", "", { parent: "fold" })]],
  ["Mode", () => [mode("fold", "review"), agent("a", "idle", "", { parent: "fold" }), agent("b", "working", "", { parent: "fold" })]],
] as const)("u7594a_a_mode_arrow_folds_and_reopens_its_children %s", async (_kind, tree) => {
  const { app } = await mountRail(tree());
  await waitFor(() => expect(rowNames()).toHaveLength(3));
  const calls = app.calls.length;
  const before = rowNames();

  expect(before).toHaveLength(3);
  press("fold");
  await waitFor(() => expect(rowNames()).toEqual(["fold"]));
  expect(rowOf("fold").getAttribute("aria-expanded")).toBe("false");
  press("fold");
  await waitFor(() => expect(rowNames()).toEqual(before));
  expect(rowOf("fold").getAttribute("aria-expanded")).toBe("true");
  expect(app.calls.slice(calls).map(call => call.method).filter(method => !["message.list", "message.reconcileWork", "pad.list", "todo.list", "machine.list", "agent.ownedChanges"].includes(method))).toEqual([]);
});

it("u7594a_a_folded_mode_stays_folded_after_remount", async () => {
  const tree = [mode("fold", "review"), agent("a", "idle", "", { parent: "fold" })];
  const storage = railStorage("/p");
  const first = await mountRail(tree, [], undefined, undefined, {}, [], undefined, undefined, storage);

  first.rail.toggleCollapsed("fold");
  await waitFor(() => expect(rowNames()).toEqual(["fold"]));
  cleanup();
  await mountRail(tree, [], undefined, undefined, {}, [], undefined, undefined, storage);
  await waitFor(() => expect(rowNames()).toEqual(["fold"]));
  expect(screen.getByRole("treeitem", { name: /fold/ }).getAttribute("aria-expanded")).toBe("false");
});

it("u7594a_a_folded_mode_reads_the_needs_you_child_like_a_folded_workstream", async () => {
  await mountRail([mode("fold", "review"), agent("a", "needs-you", "", { parent: "fold" })]);
  await waitFor(() => expect(rowNames()).toHaveLength(2));
  press("fold");
  await waitFor(() => expect(rowNames()).toEqual(["fold"]));
  expect(within(rowOf("fold")).getAllByLabelText(/^Needs-you/).length).toBeGreaterThan(0);
});
