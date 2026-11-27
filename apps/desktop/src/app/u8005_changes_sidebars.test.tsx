import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { WORKTREE } from "../changes/harness";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";

afterEach(async () => { cleanup(); await new Promise(resolve => setTimeout(resolve)); localStorage.clear(); });

const started = async (shelfOpen = true, folded = false) => {
  if (folded) localStorage.setItem("roundup:viewer", JSON.stringify({ collapsed: true }));

  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

  const app = createFakeApp();

  app.opened.project = { name: "payments-api", path: "/repos/payments-api" };
  app.handlers["rail.tree"] = () => [agent("a", "working", "x", { name: "scout", worktree: WORKTREE }), agent("b", "done", "x", { name: "mason" })];
  app.handlers["agent.worktreeState"] = () => ({ ahead: 0, behind: 0, dirty: true });
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1, counts: null, blob: null }] });
  app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: WORKTREE.path, checkout: WORKTREE.path, branch: WORKTREE.branch, base: "main", files: [{ path: "src/a.ts", status: "modified", line: 1, counts: null, blob: null }] }] });

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} initialShelfOpen={shelfOpen} />);
  await screen.findByText("mason");

  return app;
};

const required = <T,>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected an element");

  return value;
};

const railFolded = () => document.querySelector(".rail")?.getAttribute("data-collapsed") === "true";

const benchOpen = () => document.querySelector(".shelf")?.getAttribute("data-open") === "true";

const changesOpen = () => screen.queryByRole("button", { name: "Close changes" }) !== null;

const openChanges = async () => { fireEvent.click(required((await screen.findAllByRole("button", { name: "1 changed file", hidden: true }))[0])); await screen.findByRole("button", { name: "Close changes" }); };

const closeChanges = async () => { fireEvent.click(screen.getByRole("button", { name: "Close changes" })); await waitFor(() => expect(changesOpen()).toBe(false)); };

it("u8005a_opening_changes_folds_the_rail_and_closes_the_bench", async () => {
  await started();
  expect(benchOpen()).toBe(true);
  await openChanges();
  await waitFor(() => expect(railFolded()).toBe(true));
  expect(benchOpen()).toBe(false);
});

it("u8005a_closing_changes_restores_the_rail_and_the_bench", async () => {
  await started();
  await openChanges();
  await waitFor(() => expect(railFolded()).toBe(true));
  await closeChanges();
  await waitFor(() => expect(railFolded()).toBe(false));
  expect(benchOpen()).toBe(true);
});

it("u8005a_closing_leaves_a_sidebar_that_was_already_folded_folded", async () => {
  await started(false, true);
  expect(railFolded()).toBe(true);
  await openChanges();
  await closeChanges();
  expect(railFolded()).toBe(true);
  expect(benchOpen()).toBe(false);
});

it("u8005a_a_sidebar_changed_by_hand_keeps_its_state_on_close", async () => {
  await started(true, true);
  await openChanges();
  fireEvent.click(screen.getByRole("button", { name: "Expand the Rail" }));
  await waitFor(() => expect(railFolded()).toBe(false));
  await closeChanges();
  expect(railFolded()).toBe(false);
  expect(benchOpen()).toBe(true);
});

it("u8005a_the_folding_changes_causes_is_not_saved", async () => {
  await started();
  await openChanges();
  await waitFor(() => expect(railFolded()).toBe(true));
  expect(JSON.parse(localStorage.getItem("roundup:viewer") ?? "{}").collapsed ?? false).toBe(false);
});

it("u8005b_a_click_on_another_agent_closes_changes_then_selects_it", async () => {
  await started();
  await openChanges();
  await waitFor(() => expect(railFolded()).toBe(true));
  fireEvent.click(screen.getByText("mason"));
  await waitFor(() => expect(changesOpen()).toBe(false));
  await waitFor(() => expect(railFolded()).toBe(false));
  expect(screen.getByRole("treeitem", { name: /mason/ }).getAttribute("aria-selected")).toBe("true");
});

it("u8005b_a_click_on_the_same_agent_changes_nothing", async () => {
  await started();
  await openChanges();
  await waitFor(() => expect(railFolded()).toBe(true));
  fireEvent.click(required(screen.getAllByText("scout")[0]));
  expect(changesOpen()).toBe(true);
  expect(railFolded()).toBe(true);
});

it("u8005b_other_ways_of_selecting_an_agent_act_as_the_click_does", async () => {
  const app = await started();
  await openChanges();
  await waitFor(() => expect(railFolded()).toBe(true));
  app.clickStateAlert("b");
  await waitFor(() => expect(changesOpen()).toBe(false));
  await waitFor(() => expect(railFolded()).toBe(false));
});
