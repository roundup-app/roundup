import { cleanup, fireEvent, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { notices } from "../testing/notices";
import { mountRail, rowOf } from "../rail/railFixture";
import { copy } from "./copy";
import { treeRow } from "./noteHarness";

afterEach(cleanup);

const OWNED: OwnedChanges = { groups: [
  { repo: "/p", checkout: "/tmp/loop-own/u1", branch: "own/x", base: "main", files: [{ path: "crates/a.rs", status: "modified", line: 7, counts: { added: 1, removed: 0 }, blob: null }] },
] };

const openOwned = async () => {
  const { app } = await mountRail([agent("a", "idle", "ready")], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => OWNED;
  });

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "1 changed file" }));

  return { app, row: await treeRow("crates/a.rs") };
};

it("u7952a_a_linked_worktree_file_opens_from_that_worktree", async () => {
  const { app, row } = await openOwned();

  row.focus();
  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(app.editorCalls).toEqual([{ path: "/tmp/loop-own/u1/crates/a.rs", line: 7 }]));
  fireEvent.dblClick(row);
  await waitFor(() => expect(app.editorCalls).toHaveLength(2));
  expect(app.editorCalls[1]).toEqual({ path: "/tmp/loop-own/u1/crates/a.rs", line: 7 });
});

it("u7952a_a_failed_open_names_the_file_and_the_checkout", async () => {
  const { app, row } = await openOwned();

  app.editorFailure = new RpcError(-32001, "not found: /p/crates/a.rs");
  fireEvent.dblClick(row);

  await waitFor(() => expect(notices("alert")).toHaveLength(1));
  expect(notices("alert")).toEqual([expect.objectContaining({ textContent: copy.openFailure("a.rs", "/tmp/loop-own/u1", "not found: /p/crates/a.rs") })]);
});
