import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { flush } from "solid-js";
import { captureActions } from "../keys/registry";
import { mountControl } from "./harness";

afterEach(cleanup);

it("u7671a_the_worktree_control_mounts_no_second_changes_surface", async () => {
  const { calls } = await mountControl();

  flush();
  expect(screen.queryByRole("button", { name: /\d+ changed files?/ })).toBeNull();
  expect(calls("agent.changedFiles")).toBe(0);
});

it("u7671a_leader_changes_opens_the_changes_view", async () => {
  const { connected } = await mountControl();
  const find = () => captureActions(document.body).find(each => each.value === "action:leader:C");

  expect(connected.hasView("changes")).toBe(false);
  await waitFor(() => expect(find()).toBeDefined());
  find()?.run();
  await waitFor(() => expect(connected.hasView("changes")).toBe(true));
});

it("u7671a_note_recovery_still_opens", async () => {
  const { connected } = await mountControl();

  connected.showView("notes");
  await screen.findByRole("dialog", { name: "Recover notes" });
});

it("u7671a_leader_changes_is_not_offered_for_an_agent_without_changed_files", async () => {
  const { connected } = await mountControl(() => ({ files: [], failure: null, truncated: false }));

  await waitFor(() => expect(connected.owned.read("a")).toBeDefined());
  expect(captureActions(document.body).some(each => each.value === "action:leader:C")).toBe(false);
});
