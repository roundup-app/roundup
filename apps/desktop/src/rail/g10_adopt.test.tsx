import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { mountRail, pinnedAdd, railCallsTo } from "./railFixture";

afterEach(cleanup);

it("g10_the_user_picks_a_listed_worktree_and_adopt_sends_the_branch_shown", async () => {
  const m = await mountRail([agent("a", "idle", "")]);
  m.app.handlers["agent.adoptable"] = () => [
    { path: "/w/feature", branch: "feature", ahead: 2, dirty: true, changed: 3, refusal: null },
    { path: "/w/owned", branch: "roundup/agent-x", ahead: 0, dirty: false, changed: 0, refusal: "owned_branch" },
  ];
  m.app.handlers["agent.adopt"] = () => agent("n", "idle", "", { name: "feature" });
  fireEvent.click(pinnedAdd());
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Adopt Worktree/ }));
  await screen.findByText(/Roundup owns this branch/);
  expect(screen.queryByRole("option", { name: /roundup\/agent-x/ })).toBeNull();
  expect(railCallsTo(m.app, "agent.adopt")).toEqual([]);
  fireEvent.click(await screen.findByRole("option", { name: /feature/ }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.adopt")).toEqual([{ path: "/w/feature", branch: "feature", parent: null }]));
});

it("g10_focus_moving_inside_the_adopt_dialog_keeps_it_open", async () => {
  const m = await mountRail([agent("a", "idle", "")]);
  m.app.handlers["agent.adoptable"] = () => [{ path: "/w/feature", branch: "feature", ahead: 0, dirty: false, changed: 0, refusal: null }];
  fireEvent.click(pinnedAdd());
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Adopt Worktree/ }));
  await screen.findByRole("option", { name: /feature/ });
  fireEvent.focusIn(screen.getByRole("dialog"));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.getByRole("option", { name: /feature/ })).toBeTruthy();
});
