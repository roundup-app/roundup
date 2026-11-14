import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent, mode, workstream } from "../../testing/nodes";
import { mountRailAndPane } from "../../terminal/paneHarness";
import { copy } from "../copy";
import { chooseAction, chooseFooter, itemOf, mountRail, railCallsTo, rowOf, settled } from "../railFixture";

afterEach(cleanup);

type Mounted = Awaited<ReturnType<typeof mountRail>>;

const never = () => new Promise<never>(() => undefined);

const startingOf = (mounted: Mounted, id: string) => mounted.rail.nodes.find(node => node.id === id)?.status?.label === "starting";

const chord = (key: string) => fireEvent.keyDown(document, { key, metaKey: true });

const exited = (id: string) => agent(id, "done", "finished", { terminal_id: null, can_resume: true });

const launches: [string, (mounted: Mounted) => Promise<string>][] = [
  ["resume", async mounted => {
    mounted.app.handlers["agent.resume"] = never;
    await chooseAction(mounted.app, "old", "Resume");

    return "old";
  }],
  ["resume with a mode", async mounted => {
    mounted.app.handlers["agent.resume"] = never;
    await chooseAction(mounted.app, "old", "Start YOLO");

    return "old";
  }],
  ["restart", async mounted => {
    mounted.app.handlers["agent.restartMode"] = never;
    fireEvent.click(within(rowOf("mode")).getByRole("button", { name: "Restart" }));

    return "mode";
  }],
  ["start door", async mounted => {
    mounted.app.handlers["rail.startDoor"] = never;
    void mounted.rail.startDoor("ws");
    await settled();

    return "ws";
  }],
];

it.each(launches)("u6000a_every_launch_renders_starting_before_its_call_answers_%s", async (_name, fire) => {
  const mounted = await mountRail([exited("old"), workstream("ws"), mode("mode", "go")]);
  await settled();
  const id = await fire(mounted);

  await waitFor(() => expect(startingOf(mounted, id)).toBe(true));
});

it("u6000a_every_launch_renders_starting_before_its_call_answers_new_agent", async () => {
  const mounted = await mountRail([workstream("ws")]);
  mounted.app.handlers["agent.spawn"] = never;
  await settled();
  chord("n");

  await waitFor(() => expect(itemOf(copy.newAgent).getAttribute("aria-label")).toContain("starting"));
});

it("u6000b_starting_stays_until_the_daemon_reports_a_later_status", async () => {
  const tree = [exited("old")];
  const mounted = await mountRail(tree);
  let answer!: () => void;

  mounted.app.handlers["agent.resume"] = () => new Promise(resolve => { answer = () => resolve(tree[0]!); });
  await settled();
  await chooseAction(mounted.app, "old", "Resume");
  await waitFor(() => expect(startingOf(mounted, "old")).toBe(true));
  tree[0] = agent("old", "working", "starting", { terminal_id: "t-old" });
  answer();
  await waitFor(() => expect(railCallsTo(mounted.app, "rail.tree").length).toBeGreaterThan(1));
  await settled();
  // The call answered while the Daemon still reports `starting`.
  expect(startingOf(mounted, "old")).toBe(true);
  tree[0] = agent("old", "working", "working", { terminal_id: "t-old" });
  await mounted.rail.refresh();
  expect(itemOf("old").getAttribute("aria-label")).toContain("working");
  expect(startingOf(mounted, "old")).toBe(false);
});

it.each([
  ["refused", new RpcError(-32003, "Cannot start: refused")],
  ["timed out", new RpcError(-32005, "Cannot start: timed out")],
  ["Daemon gone", new Error("the Daemon is gone")],
] as const)("u6000c_a_refused_start_shows_the_failure_text_and_retry_without_starting_%s", async (_name, failure) => {
  const mounted = await mountRail([exited("old")]);

  mounted.app.handlers["agent.resume"] = () => {
    // A Daemon that is gone answers neither the call nor the read that follows it.
    if (!(failure instanceof RpcError)) mounted.app.handlers["rail.tree"] = () => { throw failure; };

    throw failure;
  };

  await settled();
  await chooseAction(mounted.app, "old", "Resume");
  await screen.findByText(failure instanceof RpcError ? failure.message : copy.resumeOutcomeUnknownTheDaemonMayHaveResumed);
  expect(rowOf("old")).toBeTruthy();
  expect(startingOf(mounted, "old")).toBe(false);
});

it.each([
  ["an abort error", Object.assign(new Error("aborted"), { name: "AbortError" }), 0],
  ["a not found", new RpcError(-32001, "no agent old"), 1],
] as const)("u6000c_an_abort_error_is_silent_and_a_not_found_refreshes_%s", async (_name, failure, refreshes) => {
  const mounted = await mountRail([exited("old")]);

  mounted.app.handlers["agent.resume"] = () => { throw failure; };

  await settled();

  const before = railCallsTo(mounted.app, "rail.tree").length;

  await chooseAction(mounted.app, "old", "Resume");
  await waitFor(() => expect(railCallsTo(mounted.app, "rail.tree").length).toBe(before + refreshes));
  await settled();

  expect(railCallsTo(mounted.app, "rail.tree").length).toBe(before + refreshes);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u6000b_no_row_shows_starting_after_the_program_is_up_or_a_failure", async () => {
  const mounted = await mountRail([workstream("ws")]);

  mounted.app.handlers["agent.spawn"] = () => { throw new Error("refused"); };

  await settled();
  chord("n");
  await screen.findByText(/refused/);
  expect(mounted.rail.nodes.some(node => node.status?.label === "starting")).toBe(false);
});

it("u6000d_launches_fired_while_one_is_pending_all_reach_the_daemon_in_order", async () => {
  const mounted = await mountRail([workstream("ws"), exited("old"), exited("other")]);
  const launched = () => mounted.app.calls.map(call => call.method).filter(method => method === "agent.spawn" || method === "agent.resume");

  mounted.app.handlers["agent.spawn"] = never;
  mounted.app.handlers["agent.resume"] = never;
  await settled();
  chord("n");
  chord("n");
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(2));
  await chooseAction(mounted.app, "old", "Resume");
  await chooseAction(mounted.app, "other", "Resume");
  // A New Agent fired while the selected row's own resume is pending.
  mounted.rail.select("old");
  chord("n");

  await waitFor(() => expect(launched()).toEqual(["agent.spawn", "agent.spawn", "agent.resume", "agent.resume", "agent.spawn"]));
  expect(railCallsTo(mounted.app, "agent.resume")).toEqual([expect.objectContaining({ id: "old" }), expect.objectContaining({ id: "other" })]);
  expect(screen.getAllByRole("treeitem").filter(row => row.getAttribute("aria-label")?.startsWith(copy.newAgent)).length).toBe(3);
});

it("u6000a_a_starting_door_row_no_longer_reads_door_stopped", async () => {
  const mounted = await mountRail([workstream("ws", { waiting: 3 })]);

  mounted.app.handlers["rail.startDoor"] = never;
  await settled();
  expect(rowOf("ws").querySelector(".rail-waiting")).not.toBeNull();
  void mounted.rail.startDoor("ws");

  await waitFor(() => expect(startingOf(mounted, "ws")).toBe(true));
  expect(rowOf("ws").querySelector(".rail-waiting")).toBeNull();
});

it("u6000a_every_launch_renders_starting_before_its_call_answers_new_workstream", async () => {
  const mounted = await mountRail([]);

  mounted.app.handlers["rail.createWorkstream"] = never;
  await settled();
  await chooseFooter("Workstream");

  await waitFor(() => expect(mounted.rail.nodes.some(node => node.kind === "workstream" && node.status?.label === "starting")).toBe(true));
});

it("u6000a_a_launching_row_shows_starting_in_the_pane_and_for_a_workstream_that_is_not_selected", async () => {
  const { app, connected } = await mountRailAndPane([workstream("ws"), workstream("other")]);

  app.handlers["rail.startDoor"] = never;
  connected.rail.select("ws");
  void connected.rail.startDoor("ws");
  void connected.rail.startDoor("other");

  await screen.findByText(copy.startingDoor("ws"));
  expect(connected.rail.nodes.find(node => node.id === "other")?.status?.label).toBe("starting");
});
