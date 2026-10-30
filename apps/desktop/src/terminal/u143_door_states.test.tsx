import { chooseAction } from "../rail/railFixture";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { RpcError } from "../app/seam";
import { agent, door, event, info, workstream } from "../testing/nodes";
import { openTabs, path } from "../header/stripFixture";
import { CHORDS } from "../keys/chords";
import { copy } from "./copy";
import { mountRailAndPane } from "./paneHarness";

afterEach(cleanup);

const startWords = () => screen.getAllByRole("button", { name: (name) => name === copy.start || name === copy.retry });

const paneStart = () => startWords().find((word) => word.closest(".pane-door"))!;

const calls = (app: { calls: { method: string; params: unknown }[] }, method: string) => app.calls.filter((call) => call.method === method).map((call) => call.params);

const startWorkstream = () => screen.getByRole("button", { name: copy.addWorkstream });

const emptyProject = async () => {
  const tree: RailNode[] = [];
  const mounted = await mountRailAndPane(tree);
  mounted.app.handlers["rail.tree"] = () => structuredClone(tree);
  mounted.app.handlers["rail.createWorkstream"] = () => {
    const created = workstream("made");
    tree.push(created);
    mounted.app.emit(event({ name: "rail.changed" }));

    return created;
  };

  return { ...mounted, tree };
};

describe("u143 empty Project", () => {




  it("u143_start_a_workstream_creates_one_root_workstream_selects_it_and_starts_only_its_door", async () => {
    const { app, connected } = await emptyProject();
    app.handlers["rail.startDoor"] = () => door("made", "working", "starting");

    fireEvent.click(startWorkstream());

    await waitFor(() => expect(calls(app, "rail.startDoor")).toMatchObject([{ id: "made" }]));
    expect([calls(app, "rail.createWorkstream"), connected.rail.selected()]).toEqual([[{ name: "workstream", parent: null }], "made"]);
  });

  it("u143_a_pending_creation_reads_creating_and_repeat_activation_calls_nothing", async () => {
    const { app } = await emptyProject();
    app.handlers["rail.createWorkstream"] = () => new Promise<RailNode>(() => {});

    fireEvent.click(startWorkstream());
    await waitFor(() => expect(startWorkstream().matches('[aria-disabled="true"]')).toBe(true));
    fireEvent.click(startWorkstream());
    fireEvent.click(screen.getByText(copy.addWorkstreamWord.trim(), { selector: ".rail-actions button" }));

    expect([calls(app, "rail.createWorkstream").length, startWorkstream().matches('[aria-disabled="true"]')]).toEqual([1, true]);
  });

  it("u143_a_failed_creation_shows_the_message_keeps_the_button_and_selects_nothing", async () => {
    const { app, connected } = await emptyProject();
    app.handlers["rail.createWorkstream"] = () => {
      throw new RpcError(-32000, "no space");
    };

    fireEvent.click(startWorkstream());

    await screen.findByRole("alert");
    await waitFor(() => expect(startWorkstream().matches('[aria-disabled="true"]')).toBe(false));
    expect([screen.getAllByRole("alert").length, startWorkstream().matches('[aria-disabled="true"]'), connected.rail.selected(), calls(app, "rail.startDoor")]).toEqual([1, false, null, []]);
  });

  it("u143_a_failed_creation_can_be_tried_again_from_the_same_button", async () => {
    const { app } = await emptyProject();
    const created = app.handlers["rail.createWorkstream"]!;
    app.handlers["rail.createWorkstream"] = () => {
      app.handlers["rail.createWorkstream"] = created;
      throw new RpcError(-32003, "no space");
    };

    app.handlers["rail.startDoor"] = () => door("made", "working", "starting");

    fireEvent.click(startWorkstream());
    await screen.findAllByRole("alert");
    await waitFor(() => expect(startWorkstream().matches('[aria-disabled="true"]')).toBe(false));
    fireEvent.click(startWorkstream());

    await waitFor(() => expect(calls(app, "rail.startDoor")).toMatchObject([{ id: "made" }]));
    expect(calls(app, "rail.createWorkstream").length).toBe(2);
  });

  it("u143_a_failed_door_launch_retries_the_same_workstream_without_creating_another", async () => {
    const { app } = await emptyProject();
    app.handlers["rail.startDoor"] = () => {
      throw new RpcError(-32003, "launch failed");
    };

    fireEvent.click(startWorkstream());
    await screen.findByText(copy.doorDidNotStart);
    app.handlers["rail.startDoor"] = () => door("made", "working", "starting");
    fireEvent.click(paneStart());

    await waitFor(() => expect(calls(app, "rail.startDoor")).toMatchObject([{ id: "made" }, { id: "made" }]));
    expect(calls(app, "rail.createWorkstream").length).toBe(1);
  });
});

describe("u143 a selected Workstream whose Door is not running", () => {
  it("u143_a_workstream_never_launched_reads_not_started_and_launches_nothing", async () => {
    const { app, connected } = await mountRailAndPane([workstream("r")]);

    connected.rail.select("r");

    expect([await screen.findByText(copy.doorNotStarted), calls(app, "rail.startDoor")]).toEqual([expect.anything(), []]);
  });

  it("u143_a_door_that_exited_reads_stopped_with_its_code_and_start_runs_it_once", async () => {
    const tree: RailNode[] = [door("r", "working", "w")];
    const { app, connected } = await mountRailAndPane(tree);

    connected.rail.select("r");
    app.emit(event({ name: "terminal.exited", data: { id: "t-r", code: 137 } }));
    await screen.findByText(copy.doorStoppedWithExit("r", "exited 137"));
    fireEvent.click(paneStart());

    await waitFor(() => expect(calls(app, "rail.startDoor")).toMatchObject([{ id: "r" }]));
  });

  it("u143_a_signalled_door_retains_its_exit_and_can_restart", async () => {
    const { app, connected } = await mountRailAndPane([door("r", "working", "w")]);
    connected.rail.select("r");
    app.emit(event({ name: "terminal.exited", data: { id: "t-r", code: null } }));
    await screen.findByText(copy.doorStoppedWithExit("r", "exited by signal"));
    fireEvent.click(paneStart());
    await waitFor(() => expect(calls(app, "rail.startDoor")).toMatchObject([{ id: "r" }]));
  });

  it("u143_a_failed_first_launch_reloads_as_stopped", async () => {
    const { app, connected } = await mountRailAndPane([door("r", "error", "launch failed", { terminal_id: null })]);
    connected.rail.select("r");
    await screen.findByText(copy.doorStopped("r"));
    expect(calls(app, "rail.startDoor")).toEqual([]);
    expect(paneStart()).toBeTruthy();
  });

  it("u143_a_running_door_shows_no_state_words", async () => {
    const { connected } = await mountRailAndPane([door("r", "working", "w")]);

    connected.rail.select("r");

    expect(document.querySelector(".pane-door")).toBeNull();
  });

  it("u143_a_pending_start_reads_starting_and_cannot_be_activated_again", async () => {
    const { app, connected } = await mountRailAndPane([workstream("r")]);
    app.handlers["rail.startDoor"] = () => new Promise<RailNode>(() => {});

    connected.rail.select("r");
    await screen.findByText(copy.doorNotStarted);
    fireEvent.click(paneStart());
    await screen.findByText(copy.startingDoor("r"));
    await waitFor(() => expect(calls(app, "rail.startDoor")).toHaveLength(1));
    fireEvent.click(paneStart());

    expect([calls(app, "rail.startDoor").length, paneStart().matches('[aria-disabled="true"]'), screen.queryByText(copy.doorNotStarted)]).toEqual([1, true, null]);
  });

  it("u143_a_failed_start_reads_did_not_start_with_the_message_and_retry", async () => {
    const { app, connected } = await mountRailAndPane([workstream("r")]);
    const failure = new RpcError(-32003, "launch failed");

    app.handlers["rail.startDoor"] = () => {
      throw failure;
    };

    connected.rail.select("r");
    await screen.findByText(copy.doorNotStarted);
    fireEvent.click(paneStart());

    expect((await screen.findByRole("alert")).textContent).toContain(failure.message);
    expect([screen.getAllByRole("alert").length, paneStart()]).toEqual([1, within(document.querySelector(".pane-door")!).getByRole("button", { name: copy.retry })]);
  });
});

describe("u143 direct Agent access beside a stopped Door", () => {
  it("u143_terminal_shortcut_opens_inside_the_stopped_workstream", async () => {
    const { app } = await openTabs({ p: [workstream("r")] });
    const daemon = app.of(path("p"));
    daemon.handlers["terminal.open"] = () => ({ terminal_id: "new" });
    daemon.handlers["terminal.list"] = () => [info("new", { owner: "r" })];
    daemon.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
    daemon.handlers["terminal.resize"] = () => null;
    fireEvent.click(screen.getByRole("treeitem", { name: "r" }));
    fireEvent.keyDown(document, { code: "KeyT", key: "t", metaKey: true });
    await waitFor(() => expect(calls(daemon, "terminal.open")).toMatchObject([{ workstream: "r" }]));
  });

  it("u143_agent_still_spawns_inside_the_selected_stopped_workstream", async () => {
    const { app, connected } = await mountRailAndPane([workstream("r")]);

    connected.rail.select("r");
    await chooseAction(app, "r", copy.addAgentMenu);

    await waitFor(() => expect(calls(app, "agent.spawn")).toMatchObject([{ cwd: "/p", prompt: null, parent: "r", model: null, effort: null }]));
  });
});



it.each(CHORDS.filter((row) => row.what === copy.newAgent || row.what === copy.newTerminal || row.what === copy.askBarShortcut))(
  "u2571b_each_empty_hint_runs_its_action $what", async (row) => {
    const { app } = await openTabs({ p: [] });
    const daemon = app.of(path("p"));
    daemon.handlers["terminal.open"] = () => ({ terminal_id: "new" });
    daemon.handlers["terminal.list"] = () => [info("new", { owner: path("p") })];
    daemon.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
    daemon.handlers["terminal.resize"] = () => null;
    const start = startWorkstream();

    start.focus();
    const press = row.presses[0]!.split("+");
    const code = press[press.length - 1]!;
    fireEvent.keyDown(start, { code, key: code === "Slash" ? "/" : code.slice(3).toLowerCase(), metaKey: true });

    if (row.what === copy.newAgent) {
      await waitFor(() => expect(calls(daemon, "agent.spawn")).toHaveLength(1));
      expect(calls(daemon, "agent.spawn")[0]).toMatchObject({ parent: null });
    } else if (row.what === copy.newTerminal) {
      await waitFor(() => expect(document.activeElement?.closest(".bubble")).not.toBeNull());
      await waitFor(() => expect(calls(daemon, "terminal.open")).toMatchObject([{ workstream: null }]));
    } else {
      const input = await screen.findByRole("textbox", { name: copy.askBarLabel });

      await waitFor(() => expect(document.activeElement).toBe(input));
      fireEvent.keyDown(input, { code: "Escape", key: "Escape" });
      await waitFor(() => expect(document.activeElement).toBe(start));
      expect(screen.getByRole("textbox", { name: copy.askBarLabel })).toBeTruthy();
    }

    expect(calls(daemon, "rail.createWorkstream")).toEqual([]);
    expect(calls(daemon, "rail.startDoor")).toEqual([]);
  },
);
