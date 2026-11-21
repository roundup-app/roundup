import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { COMPARISON, treeRow } from "./noteHarness";

afterEach(cleanup);

const NOT_FOUND = -32001;

const OWNED: OwnedChanges = { groups: [
  { repo: "/p", branch: "main", base: "main", files: [{ path: "own.ts", status: "modified", line: 1, counts: { added: 1, removed: 0 }, blob: null }] },
  { repo: "/q", branch: "own/x", base: "main", files: [{ path: "other.ts", status: "added", line: 1, counts: { added: 2, removed: 0 }, blob: null }] },
] };

const reads = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter(call => call.method === "agent.compareFile").map(call => call.params);

it("u7853a_changes_reads_send_the_open_group", async () => {
  const worktree = { worktree: { path: "/w/b", branch: "own/b", base: "main", adopted: false } };

  const { app } = await mountRail([agent("a", "idle", "ready"), agent("b", "idle", "ready", worktree)], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => OWNED;
    // The Daemon reads an Agent with no Worktree only through a group.
    app.handlers["agent.compareFile"] = ({ id, path, group }) => {
      if (!group && id === "a") throw new RpcError(NOT_FOUND, "no_worktree: a");

      return { ...COMPARISON, oldPath: path, newPath: path };
    };
  });

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "2 changed files" }));
  await treeRow("own.ts");
  await waitFor(() => expect(reads(app).at(-1)).toEqual({ id: "a", path: "own.ts", group: { repo: "/p", branch: "main" } }));

  const groups = await screen.findByRole("list", { name: "Repositories and branches" });

  const [, second] = within(groups).getAllByRole("button");

  if (!second) throw new Error("The group list has no second group");

  fireEvent.click(second);
  await treeRow("other.ts");
  await waitFor(() => expect(reads(app).at(-1)).toEqual({ id: "a", path: "other.ts", group: { repo: "/q", branch: "own/x" } }));

  fireEvent.click(rowOf("b"));
  await screen.findByText("b", { selector: ".changes-name" });
  await waitFor(() => expect(reads(app).at(-1)).toEqual({ id: "b", path: "own.ts", group: { repo: "/p", branch: "main" } }));
});
