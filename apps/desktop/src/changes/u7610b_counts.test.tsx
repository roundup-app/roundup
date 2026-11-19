import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { agent } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { COMPARISON } from "./noteHarness";

afterEach(cleanup);

const OWNED: OwnedChanges = { groups: [{ repo: "/p", branch: "main", base: "main", files: [
  { path: "a.ts", status: "modified", line: 3, counts: { added: 10000, removed: 9998 } },
  { path: "logo.png", status: "modified", line: null, counts: null },
] }] };

const open = async () => {
  const mounted = await mountRail([agent("a", "idle", "ready")], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => OWNED;
    app.handlers["project.compareRefs"] = () => ({ refs: [{ kind: "head" as const, branch: "main", label: "main" }, { kind: "worktree" as const, path: "/p", branch: "main", label: "p (main)" }] });
    app.handlers["agent.changedFiles"] = () => OWNED.groups[0] ?? { files: [] };
    app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  });

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "2 changed files" }));
  await screen.findByRole("heading", { name: "Changes: a vs main" });

  return mounted;
};

it("u7610b_rows_show_the_daemon_counts_and_a_binary_file_shows_none", async () => {
  await open();

  const row = await screen.findByRole("button", { name: /a\.ts/ });

  expect(within(row).getByText(/10000/)).toBeTruthy();
  expect(within(row).getByText(/9998/)).toBeTruthy();
  expect((await screen.findByRole("button", { name: /logo\.png/ })).querySelector(".changes-counts")).toBeNull();
});

it("u7610b_opening_the_list_never_calls_compare_file", async () => {
  const { app } = await open();

  await screen.findByRole("button", { name: /a\.ts/ });
  fireEvent.click(screen.getByRole("combobox", { name: "From" }));
  fireEvent.click(await screen.findByRole("option", { name: "p (main)" }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.changedFiles").length).toBe(1));
  expect(within(await screen.findByRole("button", { name: /a\.ts/ })).getByText(/10000/)).toBeTruthy();
  expect(app.calls.filter(call => call.method === "agent.compareFile")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /a\.ts/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.compareFile").length).toBeGreaterThan(0));
});
