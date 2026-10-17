import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { fromBase64 } from "../terminal/base64";
import { SEEDS, seedApp } from "./seeds";
import type { SeedName } from "./seeds";
import type { Event as DaemonEvent } from "@contracts/Event";
import { event } from "./nodes";
import { showShelfTab } from "./shelfTabs";

const NOW = 1_700_000_000_000;

const mount = (seed: SeedName) => {
  const controls = seedApp(seed, Date.now());
  render(() => <App app={controls.app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  return controls;
};

const rail = () => screen.findByRole("region", { name: "Rail" });

// This suite checks seed wiring; transform the real lazy editor before timing Drawer interactions.
beforeAll(async () => {
  await import("../pads/PadRichEditor");
});

afterEach(cleanup);

describe("u26 the harness seeds", () => {
  it("u26_the_seeds_include_the_first_workstream_screens_the_recipe_documents", () => {
    expect(SEEDS).toEqual(["first-run", "agents-10", "tree-40", "daemon-exits", "conflict", "empty-project", "door-stopped", "door-report", "decisions", "earlier-run", "tabs-8", "bubbles", "resources"]);
  });

  it("u26_first_run_shows_the_empty_rail_text", async () => {
    mount("first-run");

    await screen.findByText("Open a folder to start");

    expect((await rail()).textContent).toBe("Workstreams and Agentsappear here, one per row,nested by indent");
  });

  it("u143_the_empty_project_seed_exposes_the_first_workstream_action", async () => {
    mount("empty-project");

    expect(await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ })).toHaveLength(2);
    expect(screen.queryByText("Open a folder to start")).toBeNull();
  });

  it("u143_the_stopped_door_seed_shows_its_exit_and_restart_action", async () => {
    mount("door-stopped");
    fireEvent.click(await screen.findByText("first workstream"));

    expect(await screen.findByText("Supervisor stopped, exited 0")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Start supervisor" }).length).toBeGreaterThan(0);
  });

  it("u83_the_earlier_run_seed_reads_the_line_for_its_selected_agent", async () => {
    const { app } = mount("earlier-run");
    fireEvent.click(await screen.findByText("earlier agent"));

    expect(await screen.findByText("No output kept from an earlier run")).toBeTruthy();
    expect(app.calls.filter((call) => call.method === "terminal.write" || call.method === "terminal.resize")).toEqual([]);
  });

  it("u26_agents_10_shows_its_first_and_last_agent_in_the_rail", async () => {
    mount("agents-10");

    const region = within(await rail());

    expect(await region.findByText("agent-1")).toBeTruthy();
    expect(region.getByText("agent-10")).toBeTruthy();
  });

  it("u26_tree_40_shows_an_agent_two_groups_deep_and_its_last_agent_in_the_rail", async () => {
    mount("tree-40");

    const region = within(await rail());

    expect(await region.findByText("token-rotation")).toBeTruthy();
    expect(region.getByText("agent-31")).toBeTruthy();
  });

  it("u26_daemon_exits_shows_the_exit_in_the_centre", async () => {
    mount("daemon-exits");

    const line = await screen.findByRole("alert");

    expect(line.textContent).toBe("Daemon exited 1");
    expect(line.querySelector("svg.lucide-x")).not.toBeNull();
  });

  it("u26_conflict_fails_the_next_call_with_conflict_and_the_one_after_succeeds", async () => {
    const { app } = mount("conflict");
    await within(await rail()).findByText("agent-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(app.rpc("rail.createWorkstream", { name: "x", parent: null })).rejects.toMatchObject({ code: -32003 });
    await expect(app.rpc("rail.createWorkstream", { name: "x", parent: null })).resolves.toMatchObject({ name: "x" });
  });

  // The real editor and tree-40 took 5.18s in the shared shard; this is seed wiring, not a latency check.
  it("u26_a_pad_the_agent_owns_opens_in_its_drawer", async () => {
    mount("tree-40");

    // U347: agent-1 runs, so its Pad is in the Shelf and, once the control is open, under it on the Rail.
    await screen.findByRole("tablist", { name: "Work items" });
    showShelfTab("Pads");
    fireEvent.click((await screen.findAllByText("pad-0"))[0]!);

    const drawer = within(await screen.findByLabelText("Drawer"));

    expect(await drawer.findByRole("button", { name: "Export .md" })).toBeTruthy();
  }, 15_000);

  it("u26_set_status_moves_the_row_to_the_new_label", async () => {
    const { setStatus } = mount("tree-40");
    await within(await rail()).findByText("agent-3");

    setStatus("agent-3", "needs-you", "asks: keep v1?");

    const row = (await within(await rail()).findByText("agent-3")).closest<HTMLElement>(".rail-row")!;

    await waitFor(() => fireEvent.pointerMove(row, { pointerType: "mouse" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("asks: keep v1?");
  });
});

describe("u26 the controls", () => {
  const listen = async (seed: SeedName) => {
    const controls = seedApp(seed, NOW);
    const seen: DaemonEvent[] = [];
    await controls.app.subscribe((received) => seen.push(received));

    return { ...controls, seen };
  };

  it("u26_write_output_delivers_the_text_bytes_to_that_terminals_subscription_only", async () => {
    const { app, writeOutput } = await listen("agents-10");
    const first: Uint8Array[] = [];
    const second: Uint8Array[] = [];

    await app.selectOutput("t-agent-1", (message) => { if (ArrayBuffer.isView(message)) first.push(message); });
    await app.selectOutput("t-agent-2", (message) => { if (ArrayBuffer.isView(message)) second.push(message); });
    writeOutput("t-agent-1", "hi");

    expect([first, second]).toEqual([[new TextEncoder().encode("hi")], []]);
  });

  it("u103_the_fake_daemon_snapshot_matches_the_output_offsets_after_a_burst", async () => {
    const { app, writeOutput } = await listen("agents-10");

    writeOutput("t-agent-1", "one ");
    writeOutput("t-agent-1", "é");
    const snapshot = await app.rpc("terminal.snapshot", { id: "t-agent-1" });
    const subscription = await app.selectOutput("t-agent-1", () => {});

    expect([snapshot.after, new TextDecoder().decode(fromBase64(snapshot.data)), subscription.offset]).toEqual([6, "one é", 6]);
    await expect(app.rpc("terminal.snapshot", { id: "absent" })).rejects.toMatchObject({ code: -32001 });
  });

  it("u26_emit_sends_the_event_it_is_given", async () => {
    const { emit, seen } = await listen("agents-10");

    emit(event({ name: "rail.changed" }));

    expect(seen).toEqual([event({ name: "rail.changed" })]);
  });

  it("u26_fail_next_rejects_one_call_with_the_given_code_and_message", async () => {
    const { app, failNext } = await listen("agents-10");

    failNext(-32001, "gone");

    await expect(app.rpc("rail.tree", null)).rejects.toMatchObject({ code: -32001, message: "gone" });
    await expect(app.rpc("rail.tree", null)).resolves.toHaveLength(10);
  });
});

describe("u26 the Daemon's rail methods", () => {
  const daemon = async () => {
    const controls = seedApp("tree-40", NOW);
    const seen: DaemonEvent[] = [];
    await controls.app.subscribe((received) => seen.push(received));
    const names = async () => (await controls.app.rpc("rail.tree", null)).map((node) => node.name);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    return { app: controls.app, seen, names, tick };
  };

  it("u26_spawning_an_agent_adds_a_node_and_sends_rail_changed", async () => {
    const { app, seen, names, tick } = await daemon();

    const spawned = await app.rpc("agent.spawn", { cwd: "/p", prompt: null, parent: "backend" });
    await tick();

    expect([(await names()).length, spawned.parent, seen]).toEqual([39, "backend", [event({ name: "rail.changed" })]]);
  });

  it("u26_creating_a_group_adds_a_group_with_the_name", async () => {
    const { app, names } = await daemon();

    await app.rpc("rail.createWorkstream", { name: "infra", parent: null });

    expect(await names()).toContain("infra");
  });

  it("u26_renaming_a_node_changes_its_name_in_the_tree", async () => {
    const { app, names } = await daemon();

    await app.rpc("rail.rename", { id: "backend", name: "api" });

    expect(await names()).toContain("api");
  });

  it("u26_promoting_a_group_makes_it_a_door_with_a_terminal", async () => {
    const { app } = await daemon();

    const promoted = await app.rpc("rail.startDoor", { id: "backend" });

    expect([promoted.kind, promoted.terminal_id]).toEqual(["workstream", "t-backend-1"]);
  });

  it("u26_moving_a_node_re_parents_it_at_the_index", async () => {
    const { app } = await daemon();

    await app.rpc("rail.move", { id: "migrate", parent: "auth", index: 0 });
    const moved = (await app.rpc("rail.tree", null)).find((node) => node.id === "migrate");

    expect([moved?.parent, moved?.order]).toEqual(["auth", 0]);
  });

  it("u26_moving_a_node_to_a_later_index_puts_it_after_the_siblings_before_that_index", async () => {
    const { app } = await daemon();

    await app.rpc("rail.move", { id: "docs", parent: "backend", index: 2 });

    const order = (await app.rpc("rail.tree", null))
      .filter((node) => node.parent === "backend")
      .sort((left, right) => left.order - right.order)
      .map((node) => node.id);

    expect(order).toEqual(["auth", "migrate", "docs"]);
  });

  it("u26_killing_a_terminal_marks_it_exited_and_sends_terminal_exited", async () => {
    const { app, seen } = await daemon();

    await app.rpc("terminal.kill", { id: "t-tokens" });
    const listed = (await app.rpc("terminal.list", null)).find((info) => info.id === "t-tokens");

    expect([listed?.running, seen]).toEqual([false, [event({ name: "terminal.exited", data: { id: "t-tokens", code: null } })]]);
  });

  it("u26_stop_advances_the_status_revision_once_and_repeated_stop_is_inert", async () => {
    const { app, seen } = await daemon();
    const before = (await app.rpc("rail.tree", null)).find((node) => node.id === "tokens")!;
    await app.rpc("agent.stop", { id: "tokens" });
    const stopped = (await app.rpc("rail.tree", null)).find((node) => node.id === "tokens")!;
    expect(stopped.attempt).toBe(before.attempt);
    expect(stopped.status_revision).toBe(String(BigInt(before.status_revision!) + 1n));
    expect(stopped.status?.kind).toBe("done");
    seen.length = 0;
    await app.rpc("agent.stop", { id: "tokens" });
    expect((await app.rpc("rail.tree", null)).find((node) => node.id === "tokens")).toEqual(stopped);
    expect(seen).toEqual([]);
  });

  it("u26_stopping_an_agent_exits_its_terminal", async () => {
    const { app } = await daemon();

    await app.rpc("agent.stop", { id: "tokens" });
    const listed = (await app.rpc("terminal.list", null)).find((info) => info.id === "t-tokens");

    expect(listed?.running).toBe(false);
  });

  it("u26_writing_to_and_resizing_a_terminal_answer_null", async () => {
    const { app } = await daemon();

    expect([
      await app.rpc("terminal.write", { id: "t-tokens", data: "bHM=" }),
      await app.rpc("terminal.resize", { id: "t-tokens", cols: 80, rows: 24 }),
    ]).toEqual([null, null]);
  });

  it("u26_a_node_that_is_not_in_the_tree_fails_with_not_found", async () => {
    const { app } = await daemon();

    await expect(app.rpc("rail.rename", { id: "nope", name: "x" })).rejects.toMatchObject({ code: -32001 });
  });
});
