import { describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Status } from "@contracts/Status";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { connectEvents } from "../app/events";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { agent, event, info, node, workstream, door, USER } from "../testing/nodes";
import { createRailState, currentOwner, type DismissalStorage } from "./rail";

const status = (label: string): Status => ({ kind: "working", label, since: 1, finished: "0" });

const open = async (tree: RailNode[], terminals: TerminalInfo[] = []) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => terminals;
  const events = await connectEvents(app);
  const rail = createRailState(app, events);
  await rail.settled();

  return { app, rail };
};

describe("u3 Rail state", () => {
  it("s3806b_terminal_failure_retains_original_recovery_without_a_rail_row", async () => {
    const target = { id: "7", incarnation: "original" };
    const { app, rail } = await open([workstream("home"), workstream("elsewhere")], [info("7", target)]);
    app.handlers["terminal.close"] = () => null;
    rail.select("home");
    const recovery = () => { void app.rpc("terminal.close", { id: target.id }); };

    rail.commandFailure.showTerminal("Close failed: rejected by Daemon", target, "pane", recovery);
    rail.select("elsewhere");
    await rail.refresh({ terminals: true });

    expect(rail.commandFailure.message()).toBe("Close failed: rejected by Daemon");
    expect(rail.commandFailure.surface()).toBe("pane");
    expect(rail.commandFailure.retry()).toBe(recovery);
    expect(app.calls.filter(call => call.method === "terminal.close")).toEqual([]);
    rail.commandFailure.retry()?.();
    expect(app.calls.filter(call => call.method === "terminal.close")).toEqual([{ method: "terminal.close", params: { id: "7" } }]);
  });

  it.each([
    { acknowledged: { kind: "rail", id: "7" }, retained: true, name: "same-id Rail row" },
    { acknowledged: { kind: "rail", id: null }, retained: true, name: "null-item New Agent" },
    { acknowledged: { kind: "terminal", id: "8", incarnation: "original" }, retained: true, name: "other Terminal" },
    { acknowledged: { kind: "terminal", id: "7", incarnation: "replacement" }, retained: true, name: "other incarnation" },
    { acknowledged: { kind: "terminal", id: "7", incarnation: "original" }, retained: false, name: "original Terminal" },
  ] as const)("s3806b_terminal_failure_acknowledgement_uses_both_namespaces_and_incarnation: $name", async ({ acknowledged, retained }) => {
    const { rail } = await open([workstream("7")], [info("7", { incarnation: "original" })]);
    rail.commandFailure.showTerminal("Close failed", { id: "7", incarnation: "original" });

    if (acknowledged.kind === "rail") rail.commandFailure.acknowledge(acknowledged.id);
    else rail.commandFailure.acknowledgeTerminal(acknowledged);

    expect(rail.commandFailure.message()).toBe(retained ? "Close failed" : null);
  });

  it.each(["removed", "replaced", "unrelated"] as const)("s3806b_terminal_failure_tracks_current_incarnation_facts: %s", async (change) => {
    const { app, rail } = await open([workstream("7")], [info("7", { incarnation: "original" }), info("8")]);
    rail.commandFailure.showTerminal("Close failed", { id: "7", incarnation: "original" }, "pane", () => {});
    app.handlers["terminal.list"] = () => change === "removed" ? [info("8")]
      : [info("7", { incarnation: change === "replaced" ? "replacement" : "original" })];
    app.emit(event({ name: "terminal.changed" }));
    await rail.settled();

    expect(rail.commandFailure.message()).toBe(change === "unrelated" ? "Close failed" : null);

    if (change !== "unrelated") {
      expect(rail.commandFailure.retry()).toBeNull();
      // Reappearance of an old id/incarnation cannot resurrect a cleared failure.
      app.handlers["terminal.list"] = () => [info("7", { incarnation: "original" })];
      await rail.refresh({ terminals: true });
      expect(rail.commandFailure.message()).toBeNull();
    }
  });

  it("s3806b_terminal_failure_dismissal_releases_recovery", async () => {
    const { rail } = await open([], [info("7")]);
    rail.commandFailure.showTerminal("Close failed", { id: "7", incarnation: "fixture-7" }, "pane", () => {});
    rail.commandFailure.clear();

    expect(rail.commandFailure.message()).toBeNull();
    expect(rail.commandFailure.retry()).toBeNull();
  });

  it("s3806b_terminal_acknowledgement_preserves_same_id_rail_failure", async () => {
    const { rail } = await open([workstream("7")], [info("7")]);
    rail.commandFailure.show("Remove failed", "7");
    rail.commandFailure.acknowledgeTerminal({ id: "7", incarnation: "fixture-7" });

    expect(rail.commandFailure.message()).toBe("Remove failed");
  });

  it("u3_the_webview_subscribes_before_its_first_rail_tree_and_terminal_list", async () => {
    const order: string[] = [];
    const app = createFakeApp();
    app.handlers["rail.tree"] = () => (order.push("rail.tree"), []);
    app.handlers["terminal.list"] = () => (order.push("terminal.list"), []);
    const subscribe = app.subscribe;
    app.subscribe = async (listener) => {
      order.push("subscribe");

      return subscribe(listener);
    };

    const events = await connectEvents(app);
    await createRailState(app, events).settled();

    expect(order).toEqual(["subscribe", "rail.tree", "terminal.list"]);
  });

  it("u3_rail_changed_refetches_the_tree", async () => {
    const { app, rail } = await open([node("a")]);
    app.handlers["rail.tree"] = () => [node("a"), node("b")];

    app.emit(event({ name: "rail.changed" }));
    await rail.settled();

    expect(rail.nodes.map((each) => each.id)).toEqual(["a", "b"]);
  });

  it("u3_agent_status_replaces_one_nodes_status", async () => {
    const { app, rail } = await open([node("a"), node("b")]);

    app.emit(event({ name: "agent.status", data: { status_revision: "2", attempt: "1", id: "b", status: status("editing") } }));

    expect(rail.nodes.map((each) => each.status?.label)).toEqual(["starting", "editing"]);
  });

  it("u3_terminal_exited_marks_the_node_with_that_terminal_id_exited_with_its_code", async () => {
    const { app, rail } = await open([node("a"), node("b")]);

    app.emit(event({ name: "terminal.exited", data: { id: "t-b", code: 3 } }));

    expect([rail.exitOf(node("a")), rail.exitOf(node("b"))]).toEqual([null, { kind: "code", code: 3 }]);
  });

  it("u3_terminal_exited_keeps_a_null_code_when_a_signal_ended_the_program", async () => {
    const { app, rail } = await open([node("a")]);

    app.emit(event({ name: "terminal.exited", data: { id: "t-a", code: null } }));

    expect(rail.exitOf(node("a"))).toEqual({ kind: "signal" });
  });

  it("u3_a_node_with_no_terminal_id_counts_as_exited", async () => {
    const { rail } = await open([]);

    expect(rail.exitOf(node("a", { terminal_id: null }))).toEqual({ kind: "unknown" });
  });

  it("u3_a_terminal_that_the_first_terminal_list_reports_exited_is_exited", async () => {
    const { rail } = await open([node("a")], [info("t-a", { running: false, exit_code: 1 })]);

    expect(rail.exitOf(node("a"))).toEqual({ kind: "code", code: 1 });
  });

  it("u3_terminal_exited_marks_a_door_whose_terminal_ended", async () => {
    const workstream = node("m", { kind: "workstream", attempt: "1" });
    const { app, rail } = await open([workstream]);

    app.emit(event({ name: "terminal.exited", data: { id: "t-m", code: 2 } }));

    expect(rail.exitOf(workstream)).toEqual({ kind: "code", code: 2 });
  });

  it("u3_events_during_an_in_flight_rail_tree_are_applied_after_it", async () => {
    const pending = Promise.withResolvers<RailNode[]>();
    const app = createFakeApp();
    app.handlers["rail.tree"] = () => pending.promise;
    const events = await connectEvents(app);
    const rail = createRailState(app, events);

    app.emit(event({ name: "agent.status", data: { status_revision: "2", attempt: "1", id: "a", status: status("early") } }));
    pending.resolve([node("a")]);
    await rail.settled();

    expect(rail.nodes[0]?.status?.label).toBe("early");
  });

  it("u3_a_rail_changed_during_an_in_flight_rail_tree_refetches_after_it", async () => {
    const pending = Promise.withResolvers<RailNode[]>();
    let fetches = 0;
    const app = createFakeApp();
    app.handlers["rail.tree"] = () => (++fetches === 1 ? pending.promise : [node("a"), node("b")]);
    const events = await connectEvents(app);
    const rail = createRailState(app, events);

    app.emit(event({ name: "rail.changed" }));
    pending.resolve([node("a")]);
    await rail.settled();

    expect(rail.nodes.map((each) => each.id)).toEqual(["a", "b"]);
  });

  it("u3_a_failed_refetch_is_surfaced_as_the_rails_failure", async () => {
    const { app, rail } = await open([node("a")]);
    app.handlers["rail.tree"] = () => Promise.reject(new RpcError(-32603, "daemon is gone"));

    app.emit(event({ name: "rail.changed" }));
    await rail.settled();

    expect(rail.failure()).toBe("daemon is gone");
  });

  it("u3_a_failure_clears_after_a_later_successful_fetch", async () => {
    const { app, rail } = await open([node("a")]);
    app.handlers["rail.tree"] = () => Promise.reject(new RpcError(-32603, "daemon is gone"));
    app.emit(event({ name: "rail.changed" }));
    await rail.settled();
    app.handlers["rail.tree"] = () => [node("a")];

    app.emit(event({ name: "rail.changed" }));
    await rail.settled();

    expect(rail.failure()).toBeNull();
  });

  it("u3_no_node_is_selected_at_start", async () => {
    const { rail } = await open([node("a")]);

    expect(rail.selected()).toBeNull();
  });

  it("u3_selecting_a_node_deselects_the_one_before_it", async () => {
    const { rail } = await open([node("a"), node("b")]);

    rail.select("a");
    rail.select("b");

    expect(rail.selected()).toBe("b");
  });

  it("u3_a_node_that_leaves_the_tree_is_no_longer_selected", async () => {
    const { app, rail } = await open([node("a"), node("b")]);
    rail.select("b");
    app.handlers["rail.tree"] = () => [node("a")];

    app.emit(event({ name: "rail.changed" }));
    await rail.settled();

    expect(rail.selected()).toBeNull();
  });

  it("u3_name_of_the_user_is_you", async () => {
    const { rail } = await open([node("a", { name: "auth-refactor" })]);

    expect(rail.nameOf(USER)).toBe("you");
  });

  it("u3_name_of_an_agent_is_its_rail_name", async () => {
    const { rail } = await open([node("a", { name: "auth-refactor" })]);

    expect(rail.nameOf({ kind: "agent", id: "a", parent: null })).toBe("auth-refactor");
  });

  it.each([
    [{ kind: "agent", id: "gone", parent: null }],
    [{ kind: "ext", id: "linter", parent: null }],
  ] as const)("u3_name_of_%j_is_its_id", async (actor) => {
    const { rail } = await open([node("a")]);

    expect(rail.nameOf(actor)).toBe(actor.id);
  });
});


it("u62_old_status_cannot_overwrite_a_restarted_door", async () => {
  const current = node("workstream", { kind: "workstream", attempt: "2", terminal_id: "new" });
  const { app, rail } = await open([current]);
  app.emit(event({ name: "agent.status", data: { status_revision: "2", id: "workstream", attempt: "1", status: { kind: "done", label: "old exit", since: 1, finished: "0" } } }));
  expect(rail.nodes[0]).toEqual(current);
  app.emit(event({ name: "agent.status", data: { status_revision: "2", id: "workstream", attempt: "2", status: status("new work") } }));
  expect(rail.nodes[0]?.status?.label).toBe("new work");
});

it("a7_delayed_same_attempt_status_cannot_replace_a_later_revision", async () => {
  const current = node("door", { kind: "workstream", attempt: "1", status_revision: "3", status: status("recovered") });
  const { app, rail } = await open([current]);
  app.emit(event({ name: "agent.status", data: { id: "door", attempt: "1", status_revision: "2", status: { kind: "error", label: "old failure", since: 0, finished: "0" } } }));
  expect(rail.nodes[0]?.status?.label).toBe("recovered");
  app.emit(event({ name: "agent.status", data: { id: "door", attempt: "1", status_revision: "4", status: status("new work") } }));
  expect(rail.nodes[0]?.status?.label).toBe("new work");
});


describe("u62 Door launch failures", () => {
  it("u62_external_start_clears_the_failed_attempt_but_ordinary_refresh_retains_it", async () => {
    const { app, rail } = await open([workstream("r", { attempt: "1", status_revision: "2" })]);
    app.handlers["rail.startDoor"] = () => Promise.reject(new Error("launch failed"));
    await rail.startDoor("r");
    await rail.refresh();
    expect(rail.doorFailure("r")).toBe("launch failed");
    app.handlers["rail.tree"] = () => [door("r", "working", "ready", { attempt: "2" })];
    app.emit(event({ name: "rail.changed" }));
    await rail.settled();
    expect(rail.doorFailure("r")).toBeNull();
  });

  it("u62_a_newer_ended_attempt_clears_the_obsolete_start_failure", async () => {
    const { app, rail } = await open([workstream("r", { attempt: "1" })]);
    app.handlers["rail.startDoor"] = () => Promise.reject(new Error("launch failed"));
    await rail.startDoor("r");
    app.handlers["rail.tree"] = () => [workstream("r", { attempt: "2" })];
    await rail.refresh();
    expect(rail.doorFailure("r")).toBeNull();
  });

  it("u62_a_late_start_rejection_does_not_cover_an_external_run_that_already_ended", async () => {
    const { app, rail } = await open([workstream("r")]);
    let reject!: (error: Error) => void;
    app.handlers["rail.startDoor"] = () => new Promise((_, fail) => { reject = fail; });
    const starting = rail.startDoor("r");
    app.handlers["rail.tree"] = () => [door("r", "working", "ready", { attempt: "2" })];
    await rail.refresh();
    app.handlers["rail.tree"] = () => [workstream("r", { attempt: "2" })];
    await rail.refresh();
    reject(new Error("old launch failed"));
    await starting;
    expect(rail.doorFailure("r")).toBeNull();
  });

  it("u62_a_late_start_rejection_does_not_cover_an_external_success", async () => {
    const { app, rail } = await open([workstream("r")]);
    let reject!: (error: Error) => void;
    app.handlers["rail.startDoor"] = () => new Promise((_, fail) => { reject = fail; });
    const starting = rail.startDoor("r");
    app.handlers["rail.tree"] = () => [door("r", "working", "ready", { attempt: "2" })];
    await rail.refresh();
    reject(new Error("old launch failed"));
    await starting;
    expect(rail.doorFailure("r")).toBeNull();
  });
});


it("u4523_current_owner_uses_rail_identity_and_liveness", async () => {
  const actor = { kind: "agent", id: "a", parent: null } as const;
  const { app, rail } = await open([node("a", { name: "Renamed" }), node("other", { name: "Renamed" })]);

  const cases = [
    { tree: [node("a", { name: "Original" })], owner: actor, exited: false, expected: { id: "a", name: "Original", live: true } },
    { tree: [node("a", { name: "Renamed", status: { kind: "done", label: "done", since: 0, finished: "0" } })], owner: actor, exited: false, expected: { id: "a", name: "Renamed", live: true } },
    { tree: [node("a", { name: "Renamed" })], owner: actor, exited: true, expected: { id: "a", name: "Renamed", live: false } },
    { tree: [node("a", { name: "Renamed", terminal_id: null })], owner: actor, exited: false, expected: { id: "a", name: "Renamed", live: false } },
    { tree: [], owner: actor, exited: false, expected: undefined },
    { tree: [], owner: { ...actor, id: "missing" }, exited: false, expected: undefined },
    { tree: [], owner: USER, exited: false, expected: undefined },
    { tree: [], owner: null, exited: false, expected: undefined },
  ];

  for (const row of cases) {
    app.handlers["rail.tree"] = () => [...row.tree, node("other", { name: "Renamed" })];
    app.handlers["terminal.list"] = () => row.exited ? [info("t-a", { running: false })] : [];
    await rail.refresh({ terminals: true });
    expect(currentOwner(rail, row.owner)).toEqual(row.expected);
  }
});

describe("U5151c", () => {
  const failed = (revision: string, attempt = "1") => agent("a", "error", "Claude's servers failed", { attempt, status_revision: revision });
  const storageDouble = (saved: string[] | null = null): DismissalStorage & { saved: () => string[] | null } => {
    let kept = saved;

    return { read: () => kept, write: async (keys) => { kept = keys; return null; }, saved: () => kept };
  };
  const mount = async (tree: RailNode[], dismissals: DismissalStorage) => {
    const app = createFakeApp();
    app.handlers["rail.tree"] = () => tree;
    app.handlers["terminal.list"] = () => [];
    const rail = createRailState(app, await connectEvents(app), undefined, dismissals);
    await rail.settled();

    return { app, rail };
  };

  it("u5151c_dismissal_is_scoped_to_one_failure", async () => {
    const store = storageDouble();
    const first = await mount([failed("1")], store);

    first.rail.dismiss(first.rail.nodes[0]!);
    const reloaded = await mount([failed("1")], storageDouble(store.saved()));
    const otherProject = await mount([failed("1")], storageDouble());
    const laterRevision = await mount([failed("2")], storageDouble(store.saved()));
    const laterAttempt = await mount([failed("1", "2")], storageDouble(store.saved()));

    expect(reloaded.rail.dismissed(reloaded.rail.nodes[0]!)).toBe(true);
    expect(otherProject.rail.dismissed(otherProject.rail.nodes[0]!)).toBe(false);
    expect(laterRevision.rail.dismissed(laterRevision.rail.nodes[0]!)).toBe(false);
    expect(laterAttempt.rail.dismissed(laterAttempt.rail.nodes[0]!)).toBe(false);
    expect(first.app.calls.map(call => call.method)).not.toContain("agent.send");
  });

  it("u5151c_next_status_replaces_the_failure", async () => {
    const { app, rail } = await mount([failed("1")], storageDouble());

    app.emit(event({ name: "agent.status", data: { status_revision: "2", attempt: "1", id: "a", status: status("working again") } }));

    expect(rail.nodes[0]?.status?.kind).toBe("working");
    expect(rail.dismissed(rail.nodes[0]!)).toBe(false);
    expect(app.calls.filter(call => !call.method.startsWith("rail.") && !call.method.startsWith("terminal.list"))).toEqual([]);
  });
});
