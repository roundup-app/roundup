import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountControl, STATE } from "./harness";

afterEach(cleanup);

const control = () => screen.getByRole("button", { name: "roundup/a" });

const rows = (): string[] => [...document.querySelectorAll("file-tree-container")].flatMap((host) => [...(host.shadowRoot?.querySelectorAll("[data-item-path]") ?? [])].map((row) => row.textContent ?? ""));

describe("U2539b", () => {
  it("u2539b_the_control_shows_the_branch_and_its_state", async () => {
    await mountControl();

    fireEvent.click(control());

    expect(await screen.findByText("main")).toBeTruthy();
    expect(await screen.findByText(`${STATE.ahead} ahead, ${STATE.behind} behind, dirty`)).toBeTruthy();
    expect(screen.getAllByText("roundup/a").length).toBeGreaterThan(0);
  });

  it("u2539b_no_worktree_shows_no_control", async () => {
    const { connected } = await mountControl();

    connected.rail.select("plain");

    await waitFor(() => expect(screen.queryByRole("button", { name: "roundup/a" })).toBeNull());
  });

  it("u2539b_opens_and_closes_back_to_the_terminal", async () => {
    await mountControl();

    fireEvent.click(control());
    const panel = await screen.findByRole("dialog", { name: "Worktree" });
    fireEvent.keyDown(panel, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Worktree" })).toBeNull());
    expect(document.activeElement).toBe(control());
  });

  it("u2539b_selecting_another_agent_closes_it", async () => {
    const { connected } = await mountControl();

    fireEvent.click(control());
    await screen.findByRole("dialog", { name: "Worktree" });
    connected.rail.select("plain");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Worktree" })).toBeNull());
  });

  it("u2539b_the_tree_lists_each_file_with_its_status", async () => {
    await mountControl();

    fireEvent.click(control());

    await waitFor(() => expect(rows().join("|")).toContain("Deleted"));
    const text = rows().join("|");
    expect(text).toContain("Modified");
    expect(text).toContain("Added");
    expect(rows().length).toBe(5);
  });

  it("u2539b_it_reads_again_on_every_open", async () => {
    const { calls } = await mountControl();

    fireEvent.click(control());
    await waitFor(() => expect(calls("agent.changedFiles")).toBe(1));
    fireEvent.click(control());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Worktree" })).toBeNull());
    fireEvent.click(control());

    await waitFor(() => expect(calls("agent.changedFiles")).toBe(2));
  });

  it("u2539b_no_changes_says_so", async () => {
    await mountControl(() => ({ files: [] }));

    fireEvent.click(control());

    expect(await screen.findByText("No changes")).toBeTruthy();
  });

  it("u2539b_a_failed_call_shows_one_failure_line", async () => {
    await mountControl(() => { throw new RpcError(-32001, "worktree_missing: /gone"); });

    fireEvent.click(control());

    expect((await screen.findByRole("alert")).textContent).toContain("worktree_missing: /gone");
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

  fireEvent.click(control());
  await screen.findByRole("alert");

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else {
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No changes");
  }

  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.calls.filter(call => call.method === "agent.changedFiles").map(call => call.params)).toEqual(Array.from({ length: action === "retry" ? 2 : 1 }, () => ({ id: "a" })));
});
