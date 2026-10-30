import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import type { ChangedFiles } from "@contracts/agent/ChangedFiles";
import { agent } from "../testing/nodes";
import { WorktreeControl } from "./WorktreeControl";
import { mountControl, STATE, WORKTREE } from "./harness";

afterEach(cleanup);

const control = () => screen.getByRole("button", { name: /\d+ changed files?/ });

const rows = (): string[] => [...document.querySelectorAll("file-tree-container")].flatMap((host) => [...(host.shadowRoot?.querySelectorAll("[data-item-path]") ?? [])].map((row) => row.textContent ?? ""));

describe("U2539b", () => {
  it("u2539b_the_control_shows_the_branch_and_its_state", async () => {
    await mountControl();
    fireEvent.click(control());
    const panel = await screen.findByRole("dialog", { name: "Worktree" });
    expect(panel.textContent).toContain(WORKTREE.base);
    expect(panel.textContent).toContain(WORKTREE.branch);
  });

  it("u2539b_no_worktree_shows_no_control", async () => {
    const { connected } = await mountControl();

    connected.rail.select("plain");

    await waitFor(() => expect(screen.queryByRole("button", { name: /\d+ changed files?/ })).toBeNull());
  });

  it("u2539b_opens_and_closes_back_to_the_terminal", async () => {
    await mountControl();

    fireEvent.click(control());
    const panel = await screen.findByRole("dialog", { name: "Worktree" });
    fireEvent.keyDown(panel, { key: "Escape" });

    await waitFor(() => expect(document.querySelector(".worktree-panel")).toBeNull());
    expect(document.activeElement).toBe(control());
  });

  it("u2539b_selecting_another_agent_closes_it", async () => {
    const { connected } = await mountControl();

    fireEvent.click(control());
    await screen.findByRole("dialog", { name: "Worktree" });
    connected.rail.select("plain");

    await waitFor(() => expect(document.querySelector(".worktree-panel")).toBeNull());
  });

  it("u2539b_it_reads_again_on_every_open", async () => {
    const { calls } = await mountControl();

    fireEvent.click(control());
    await waitFor(() => expect(calls("agent.changedFiles")).toBeGreaterThan(1));
    const before = calls("agent.changedFiles");
    fireEvent.click(control());
    await waitFor(() => expect(document.querySelector(".worktree-panel")).toBeNull());
    fireEvent.click(control());

    await waitFor(() => expect(calls("agent.changedFiles")).toBeGreaterThan(before));
  });

  it("u2539b_empty_changes_mount_no_control_or_view", async () => {
    const { calls } = await mountControl(() => ({ files: [] }));

    await waitFor(() => expect(calls("agent.changedFiles")).toBeGreaterThan(0));
    await waitFor(() => expect(document.querySelector(".worktree-control")).toBeNull());
    expect(document.querySelector(".worktree-panel")).toBeNull();
    expect(document.querySelector("file-tree-container")).toBeNull();
  });

  it("u4464_no_empty_view_before_the_first_answer_changes", async () => {
    const app = createFakeApp();
    const answer = Promise.withResolvers<ChangedFiles>();
    app.handlers["rail.tree"] = () => [agent("a", "idle", "ready", { worktree: WORKTREE })];
    app.handlers["agent.changedFiles"] = () => answer.promise;
    app.handlers["agent.worktreeState"] = () => STATE;
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
    connected.rail.select("a");
    render(() => {
      connected.worktrees.watch(() => true);

      return <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>;
    });
    await waitFor(() => expect(app.calls.some(call => call.method === "agent.changedFiles")).toBe(true));
    expect(screen.queryByRole("button", { name: /changed files?/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    answer.resolve({ files: [{ path: "a.ts", status: "modified", line: 1 }] });
    expect(await screen.findByRole("button", { name: /1 changed file/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("u2539b_a_failed_read_is_not_no_changes", async () => {
    const cause = "worktree_missing: /gone";
    await mountControl(() => { throw new RpcError(-32001, cause); });

    expect(document.querySelector(".worktree-control")).toBeNull();
    await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("u2539b_the_tree_is_one_tab_stop", async () => {
    await mountControl();

    fireEvent.click(control());
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const host = document.querySelector("file-tree-container")!;
    const stops = [...host.shadowRoot!.querySelectorAll<HTMLElement>("[tabindex]")].filter((element) => element.tabIndex >= 0);

    expect(stops.length).toBe(1);
    await waitFor(() => expect(host.shadowRoot!.activeElement).toBe(stops[0]));
  });
});

it.each(["retry", "dismiss"])("p3557c_failure_lifetime_worktree_control: %s", async action => {
  let failed = true;

  const { app } = await mountControl(() => { if (failed) throw new RpcError(-32001, "list refused; retry loading files");

 return { files: [] }; });

  await screen.findByRole("alert");

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else {
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  }

  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.calls.filter(call => call.method === "agent.changedFiles").map(call => call.params)).toEqual(Array.from({ length: action === "retry" ? 5 : 4 }, () => ({ id: "a" })));
});


it("u2539b_changed_files_have_one_counted_opener", async () => {
  await mountControl();
  expect(document.querySelectorAll(".worktree-control")).toHaveLength(1);
  expect(Number(control().textContent)).toBe(3);
  expect(document.querySelector(".worktree-branch")).toBeNull();
});

it("u2539b_refresh_reconciles_the_count_for_its_selection", async () => {
  let changed = { files: [{ path: "one", status: "modified" as const, line: 1 }] };
  const { connected } = await mountControl(() => changed);
  changed = { files: [] };
  await connected.worktrees.refresh("a");
  await waitFor(() => expect(document.querySelector(".worktree-control")).toBeNull());
});

it("u2539b_failed_refresh_keeps_the_stale_count_until_retry", async () => {
  const cause = "read failed; original cause";
  let failed = false;

  const { connected } = await mountControl(() => {
    if (failed) throw new RpcError(-32001, cause);

    return { files: [{ path: "one", status: "modified", line: 1 }] };
  });

  failed = true;
  await connected.worktrees.refresh("a");
  await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(control().getAttribute("data-stale")).toBe("true");
  expect(Number(control().textContent)).toBe(1);
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(control().hasAttribute("data-stale")).toBe(false);
});
