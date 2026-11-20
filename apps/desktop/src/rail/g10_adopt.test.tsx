import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { mountRail, pinnedAdd, railCallsTo } from "./railFixture";

afterEach(cleanup);

it("g10_the_user_picks_a_listed_worktree_and_adopt_sends_the_branch_shown", async () => {
  const m = await mountRail([agent("a", "idle", "")]);
  m.app.handlers["agent.adoptable"] = () => [
    { path: "/w/feature", branch: "feature", ahead: 2, dirty: true, refusal: null },
    { path: "/w/owned", branch: "roundup/agent-x", ahead: 0, dirty: false, refusal: "owned_branch" },
  ];
  m.app.handlers["agent.adopt"] = () => agent("n", "idle", "", { name: "feature" });
  fireEvent.click(pinnedAdd());
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Adopt worktree/ }));
  const owned = await screen.findByRole("button", { name: /roundup\/agent-x/ });
  expect(owned).toHaveProperty("disabled", true);
  expect(railCallsTo(m.app, "agent.adopt")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /feature/ }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.adopt")).toEqual([{ path: "/w/feature", branch: "feature" }]));
});
