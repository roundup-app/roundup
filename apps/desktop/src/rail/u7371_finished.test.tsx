import type { WorktreeState } from "@contracts/agent/WorktreeState";
import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

const at = (name: string) => ({ path: `/p/${name}`, branch: name, base: "base" });

const done: WorktreeState = { ahead: 0, behind: 3, dirty: false, integrated: true };

afterEach(cleanup);

const serve = async (nodes: Parameters<typeof mountRail>[0], facts: Record<string, WorktreeState>, ids: string[]) => {
  const mounted = await mountRail(nodes);

  await waitFor(() => expect(ids.every(id => mounted.connected.worktrees.read(id)?.failure === null)).toBe(true));
  mounted.app.handlers["agent.worktreeState"] = ({ id }) => facts[id] ?? { ahead: 0, behind: 0, dirty: false };
  mounted.setNow(100_000_000_000_000);

  return mounted;
};

it("u7371a_chip_shows_draft_and_open", async () => {
  await serve([agent("a", "idle", "ok", { worktree: at("a") }), agent("b", "idle", "ok", { worktree: at("b") }), agent("c", "idle", "ok", { worktree: at("c") })], {
    a: { ahead: 1, behind: 0, dirty: false, pr: { number: 7, stale: false, draft: true } },
    b: { ahead: 1, behind: 0, dirty: false, pr: { number: 8, stale: false, draft: false } },
    c: { ahead: 1, behind: 0, dirty: false, pr: { number: 9, stale: false } },
  }, ["a", "b", "c"]);
  const draft = await screen.findByLabelText("PR #7, draft");
  const open = await screen.findByLabelText("PR #8, open");
  const unknown = await screen.findByLabelText("PR #9");

  expect([draft.dataset.state, open.dataset.state, unknown.dataset.state]).toEqual(["draft", "open", "pr"]);
  expect([draft.textContent, open.textContent, unknown.textContent]).toEqual(["#7 draft", "#8 open", "#9"]);
  expect(draft.getAttribute("role")).toBe("img");
  expect(draft.tabIndex).toBe(-1);
});

it("u7371b_integrated_clean_row_dims", async () => {
  const names = ["merged", "fresh", "dirty", "ahead", "bare"];
  await serve([...names.slice(0, 4).map(name => agent(name, "idle", "ok", { worktree: at(name) })), agent("bare", "idle", "ok")], {
    merged: done,
    fresh: { ahead: 0, behind: 0, dirty: false },
    dirty: { ...done, dirty: true },
    ahead: { ...done, ahead: 2 },
  }, names.slice(0, 4));
  await waitFor(() => expect(rowOf("merged").dataset.finished).toBe("true"));
  expect(names.slice(1).map(name => rowOf(name).dataset.finished)).toEqual([undefined, undefined, undefined, undefined]);
});

it("u7371c_workstream_dims_only_when_all_rows_do", async () => {
  const mounted = await serve([
    workstream("all"), agent("a1", "idle", "ok", { parent: "all", worktree: at("a1") }), agent("a2", "idle", "ok", { parent: "all", worktree: at("a2") }),
    workstream("mixed"), agent("m1", "idle", "ok", { parent: "mixed", worktree: at("m1") }), agent("m2", "idle", "ok", { parent: "mixed", worktree: at("m2") }),
    workstream("bare"), agent("b1", "idle", "ok", { parent: "bare", worktree: at("b1") }), agent("b2", "idle", "ok", { parent: "bare" }),
    workstream("empty"),
  ], { a1: done, a2: done, m1: done, m2: { ...done, dirty: true }, b1: done }, ["a1", "a2", "m1", "m2", "b1"]);

  await waitFor(() => expect(rowOf("all").dataset.finished).toBe("true"));
  expect(["mixed", "bare", "empty"].map(id => rowOf(id).dataset.finished)).toEqual([undefined, undefined, undefined]);
  expect(mounted.connected.worktrees.finished("m1")).toBe(true);
});
