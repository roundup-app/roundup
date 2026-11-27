import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { agent } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { copy } from "./copy";
import { answers } from "./flowFixture";
import { COMPARISON, take, treeRow } from "./noteHarness";

afterEach(cleanup);

const GROUP = { repo: "/p", branch: "main" };

const OWNED: OwnedChanges = { groups: [{ ...GROUP, checkout: "/p", base: "main", files: [{ path: "own.ts", status: "modified", line: 1, counts: { added: 1, removed: 0 }, blob: null }] }] };

const READS = ["agent.callPaths", "agent.repeatScan", "agent.readback"];

it("u7955a_changes_reads_send_the_open_group_and_flows_traces", async () => {
  const worktree = { worktree: { path: "/w/b", branch: "own/b", base: "main", adopted: false } };

  const { app } = await mountRail([agent("a", "idle", "ready"), agent("b", "idle", "ready", worktree)], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => OWNED;
    app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
    app.handlers["agent.callPaths"] = answers();
    app.handlers["agent.changedFiles"] = () => OWNED.groups[0] ?? { files: [] };
  });

  // The Daemon refuses a read with no `group` for Agent `a`, which has no Worktree; the fake does the same.
  const sent = (method: string) => app.calls.filter(call => call.method === method).map(call => call.params);

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "1 changed file" }));
  take(await treeRow("own.ts"));
  fireEvent.click(await screen.findByRole("radio", { name: copy.lenses.flows }));

  await waitFor(() => expect(sent("agent.callPaths")).toEqual([{ id: "a", group: GROUP }, { id: "a", group: GROUP, language: "typescript" }]));
  await waitFor(() => expect(sent("agent.repeatScan")).toEqual([{ id: "a", group: GROUP }]));
  await waitFor(() => expect(sent("agent.readback")[0]).toEqual({ id: "a", group: GROUP }));
  expect(READS.flatMap(sent).filter(params => Reflect.has(Object(params), "to"))).toEqual([]);
});
