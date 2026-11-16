import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { agent, event } from "../testing/nodes";
import { mountRail, rowOf, settled } from "../rail/railFixture";
import { diffsLoaded } from "./DiffReader";
import { COMPARISON } from "./noteHarness";

afterEach(cleanup);

const OWNED: OwnedChanges = { groups: [
  { repo: "/p", branch: "main", base: "main", files: [{ path: "a.ts", status: "modified", line: 3 }, { path: "b.rs", status: "added", line: 1 }] },
  { repo: "/q", branch: "own/x", base: "main", files: [{ path: "a.ts", status: "modified", line: 1 }] },
] };

const REFS = { refs: [
  { kind: "worktree" as const, path: "/p", branch: "main", label: "p (main)" },
  { kind: "worktree" as const, path: "/q", branch: "own/x", label: "q (own/x)" },
  { kind: "head" as const, branch: "main", label: "main" },
  { kind: "head" as const, branch: "own/x", label: "own/x" },
] };

const mountRailWith = (owned: (id: string) => OwnedChanges | Promise<OwnedChanges>) =>
  mountRail([agent("a", "idle", "ready"), agent("plain", "idle", "ready")], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => { app.handlers["agent.ownedChanges"] = ({ id }) => owned(id); });

it("u7186c_the_row_shows_the_icon_with_the_count_only_above_zero", async () => {
  const { app } = await mountRailWith(id => id === "a" ? OWNED : { groups: [] });

  await within(rowOf("a")).findByRole("button", { name: "3 changed files" });
  expect(within(rowOf("plain")).queryByRole("button", { name: /changed file/ })).toBeNull();
  expect(app.calls.filter(call => call.method === "agent.ownedChanges").length).toBe(2);
});

it("u7186c_the_icon_opens_the_centre_diff_preset_to_base_and_now", async () => {
  const { app } = await mountRailWith(() => OWNED);

  app.handlers["project.compareRefs"] = () => REFS;
  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "3 changed files" }));
  await screen.findByRole("heading", { name: "Changes: a vs main" });
  await within(screen.getByRole("combobox", { name: "From" })).findByText("main");
  await within(screen.getByRole("combobox", { name: "To" })).findByText("p (main)");
  expect(screen.getAllByRole("button", { name: /\.ts|\.rs/ }).length).toBe(2);
});

it("u7186c_the_count_reads_on_a_file_write_and_a_turn_end_not_on_a_timer", async () => {
  const { app, setNow } = await mountRailWith(() => OWNED);
  const reads = () => app.calls.filter(call => call.method === "agent.ownedChanges").length;
  const call = (tool: string, state: "running" | "done") => event({ name: "agent.toolCall", data: { id: "a", call: { tool, arguments: "{}", state, started: 0 } } });

  await settled();
  const first = reads();

  setNow(100_000_000_000_000);
  app.emit(call("Read", "done"));
  app.emit(call("Write", "running"));
  await settled();
  expect(reads()).toBe(first);
  app.emit(call("Edit", "done"));
  await waitFor(() => expect(reads()).toBe(first + 1));
  app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "done", label: "done", since: 0, finished: "1" } } }));
  await waitFor(() => expect(reads()).toBe(first + 2));
});

it("u7186c_the_reader_stays_lazy", async () => {
  const { app } = await mountRailWith(() => OWNED);

  app.handlers["project.compareRefs"] = () => REFS;
  app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "3 changed files" }));
  const files = await screen.findAllByRole("button", { name: /a\.ts/ });

  expect(diffsLoaded()).toBe(false);
  fireEvent.click(files[0] ?? screen.getByRole("button", { name: /a\.ts/ }));
  await waitFor(() => expect(diffsLoaded()).toBe(true));
});

it("u7186c_a_failed_read_shows_retry_and_no_count", async () => {
  let fail = true;

  const { app } = await mountRailWith(id => {
    if (fail && id === "a") throw new Error("git is unavailable");

    return id === "a" ? OWNED : { groups: [] };
  });

  await screen.findByText(/git is unavailable/);
  expect(within(rowOf("a")).queryByRole("button", { name: /changed file/ })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await within(rowOf("a")).findByRole("button", { name: "3 changed files" });
  expect(app.calls.filter(call => call.method === "agent.ownedChanges").length).toBeGreaterThan(1);
});
