import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { agent } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { COMPARISON, treeRow } from "./noteHarness";

afterEach(cleanup);

const OWNED: OwnedChanges = { groups: [{ repo: "/p", branch: "main", base: "main", files: [
  { path: "a.ts", status: "modified", line: 3, counts: { added: 10000, removed: 9998 }, blob: null },
  { path: "logo.png", status: "modified", line: null, counts: null, blob: null },
] }] };

const open = async () => {
  const mounted = await mountRail([agent("a", "idle", "ready", { worktree: { path: "/p", branch: "own/a", base: "main", adopted: false } })], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => OWNED;
    app.handlers["agent.changedFiles"] = () => OWNED.groups[0] ?? { files: [] };
    app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  });

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "2 changed files" }));
  await screen.findByRole("region", { name: "Changes" });

  return mounted;
};

it("u7610b_rows_show_the_daemon_counts_and_a_binary_file_shows_none", async () => {
  await open();

  const row = await treeRow("a.ts");

  await waitFor(() => expect(row.textContent).toMatch(/10000.*9998/));
  expect((await treeRow("logo.png")).textContent).not.toMatch(/\d{3}/);
});

it("u7610b_opening_the_list_never_calls_compare_file", async () => {
  const { app } = await open();

  await treeRow("a.ts");
  fireEvent.click(screen.getByRole("radio", { name: "Tree" }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.changedFiles").length).toBe(1));
  // SAFETY: every agent.compareFile call carries a `path`.
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.compareFile").map(call => (call.params as { path: string }).path)).toEqual(["a.ts"]));
  fireEvent.click(await treeRow("logo.png"));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.compareFile").length).toBe(2));
});
