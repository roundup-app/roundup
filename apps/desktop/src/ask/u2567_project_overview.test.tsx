import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { copy } from "../copy";
import { agent, door, event, terminal, workstream } from "../testing/nodes";
import type { RailNode } from "@contracts/agent/RailNode";
import { input, mountAskBar, press } from "./askFixture";

afterEach(cleanup);

it("u2567a_entries_follow_rail_order_with_door_status", async () => {
  await mountAskBar([], null, [door("b", "working", "busy", { order: 2 }), workstream("a", { order: 1, status: null })]);

  const overview = screen.getByRole("region", { name: "Project overview" });

  expect(within(overview).getAllByRole("button").map((button) => button.textContent)).toEqual(["a", "bWorking"]);
});

const overview = () => screen.getByRole("region", { name: "Project overview" });

const buttons = () => within(overview()).getAllByRole("button");

const names = () => buttons().map((button) => button.textContent);

const tree = (): RailNode[] => [
  door("a", "error", "failed"),
  door("b", "working", "busy", { order: 1 }),
  agent("parent", "working", "busy", { parent: "b" }),
  agent("waiting", "needs-you", "permission", { parent: "parent" }),
  terminal("terminal", { parent: "a" }),
];

it("u2567a_attention_lines_sit_under_the_right_workstream", async () => {
  const { connected } = await mountAskBar([], null, tree());
  connected.rail.toggleCollapsed("b");

  expect([...overview().querySelectorAll(".overview-list > li")].map((item) => item.textContent)).toEqual(["aErroraError", "bWorkingwaitingNeeds-you"]);
  expect(within(overview()).getByRole("heading").textContent).toBe("2 need you");
});

it("u2567a_root_agents_need_attention_without_workstreams", async () => {
  await mountAskBar([], null, [agent("parent", "working", "busy"), agent("waiting", "needs-you", "permission", { parent: "parent" })]);

  expect(names()).toEqual(["waitingNeeds-you"]);
  expect(within(overview()).getByRole("heading").textContent).toBe("1 needs you");
  expect(input()).not.toBeNull();
});

it("u2567a_attention_is_error_first_then_oldest_since", async () => {
  await mountAskBar([], null, [workstream("a", { status: null }),
    agent("new", "needs-you", "permission", { parent: "a", status: { kind: "needs-you", label: "permission", since: 20 } }),
    agent("old", "needs-you", "permission", { parent: "a", status: { kind: "needs-you", label: "permission", since: 10 } }),
    agent("error", "error", "failed", { parent: "a", status: { kind: "error", label: "failed", since: 30 } })]);

  expect(names()).toEqual(["a", "errorError", "oldNeeds-you", "newNeeds-you"]);
});

it("u2567a_nothing_needs_you", async () => {
  await mountAskBar([], null, [door("a", "working", "busy"), terminal("terminal")]);
  expect(within(overview()).getByRole("heading").textContent).toBe("Nothing needs you");
});

it("u2567b_a_status_event_moves_the_line_and_the_count", async () => {
  const { app, connected } = await mountAskBar([], null, tree());
  app.emit(event({ name: "agent.status", data: { id: "waiting", attempt: "1", status_revision: "2", status: { kind: "working", label: "busy", since: 40 } } }));
  await connected.rail.settled();

  expect(names()).toEqual(["aError", "aError", "bWorking"]);
  expect(within(overview()).getByRole("heading").textContent).toBe("1 needs you");
});

it("u2567b_create_and_remove_follow_the_tree", async () => {
  const { app, connected } = await mountAskBar([], null, tree());
  app.handlers["rail.tree"] = () => [workstream("new", { order: 0, status: null }), door("b", "needs-you", "permission", { order: 1 })];
  app.emit(event({ name: "rail.changed" }));
  await connected.rail.settled();

  expect(names()).toEqual(["new", "bNeeds-you", "bNeeds-you"]);
  expect(within(overview()).getByRole("heading").textContent).toBe("1 needs you");
});

it("u2567b_the_overview_makes_no_call_of_its_own", async () => {
  const { app, connected } = await mountAskBar([], null, tree());
  app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "working", label: "busy", since: 40 } } }));
  await connected.rail.settled();

  expect(app.calls.map((call) => call.method).sort()).toEqual(["ask.list", "daemon.ping", "decision.list", "rail.tree", "terminal.list"]);
});

it("u2567c_activating_an_entry_selects_its_workstream_and_shows_the_terminal", async () => {
  const { app, connected } = await mountAskBar([], null, tree(), true);
  app.calls.length = 0;
  fireEvent.click(buttons()[0]!);

  await waitFor(() => expect(document.querySelector('[data-terminal="t-a"]')).not.toBeNull());
  expect(connected.rail.selected()).toBe("a");
  expect(app.outputSubscriptions.map((subscription) => subscription.id)).toContain("t-a");
  expect(app.calls.filter((call) => !["terminal.snapshot", "terminal.resize"].includes(call.method))).toEqual([]);
});

it("u2567c_activating_an_attention_line_selects_that_agent", async () => {
  const { connected } = await mountAskBar([], null, tree(), true);
  fireEvent.click(within(overview()).getByRole("button", { name: "waiting Needs-you" }));

  await waitFor(() => expect(document.querySelector('[data-terminal="t-waiting"]')).not.toBeNull());
  expect(connected.rail.selected()).toBe("waiting");
});

it("u2567c_a_stopped_door_is_selected_but_not_started", async () => {
  const { app, connected } = await mountAskBar([], null, [workstream("stopped", { status: null })], true);
  app.calls.length = 0;
  fireEvent.click(within(overview()).getByRole("button", { name: "stopped" }));

  expect(await screen.findByRole("button", { name: copy.start })).toBeDefined();
  expect(connected.rail.selected()).toBe("stopped");
  expect(app.calls).toEqual([]);
  expect(app.outputSubscriptions).toEqual([]);
});

it("u2567c_the_entries_are_reachable_by_keyboard_in_order", async () => {
  await mountAskBar([], null, tree());

  expect(buttons().map((button) => [button.tagName, button.tabIndex])).toEqual([["BUTTON", 0], ["BUTTON", 0], ["BUTTON", 0], ["BUTTON", 0]]);

  for (const button of buttons()) {
    button.focus();
    expect(document.activeElement).toBe(button);
  }
});

it("u2567c_the_shortcut_overlay_has_no_overview", async () => {
  await mountAskBar([], "a", tree());
  press("/", { metaKey: true });

  await waitFor(() => expect(input()).not.toBeNull());
  expect(screen.queryByRole("region", { name: "Project overview" })).toBeNull();
});

it("u2567d_empty_rail_shows_u143_and_no_overview", async () => {
  await mountAskBar([], null, [], true);

  expect(screen.getByText("No Workstream yet")).toBeDefined();
  expect(input()).toBeNull();
  expect(screen.queryByRole("region", { name: "Project overview" })).toBeNull();
});

it("u2567d_before_the_first_tree_shows_no_all_clear", async () => {
  let answer!: (nodes: RailNode[]) => void;
  const mounting = mountAskBar([], null, new Promise<RailNode[]>((resolve) => { answer = resolve; }), true);

  await screen.findByText("No Workstream yet");
  expect(screen.queryByText("Nothing needs you")).toBeNull();
  answer(tree());
  await mounting;
});

it("u2567d_a_failed_refetch_keeps_the_list_and_shows_the_error", async () => {
  const { app, connected } = await mountAskBar([], null, tree());

  app.handlers["rail.tree"] = () => { throw new Error("offline"); };

  await connected.rail.refresh();

  expect(within(overview()).getByRole("alert").textContent).toContain("offline");
  expect(names()).toEqual(["aError", "aError", "bWorking", "waitingNeeds-you"]);
  expect(input()).not.toBeNull();

  app.handlers["rail.tree"] = () => tree();

  await connected.rail.refresh();
  expect(within(overview()).queryByRole("alert")).toBeNull();
});
