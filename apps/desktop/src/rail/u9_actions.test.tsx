import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { fakeEmulators } from "../terminal/paneHarness";
import { RpcError } from "../app/seam";
import { chord, glyphOf, mountRail, pinnedAdd, railCallsTo, rowNames, rowOf, settled } from "./railFixture";
import { agent, event, workstream, door } from "../testing/nodes";

afterEach(cleanup);

const SPAWNED = agent("fresh", "idle", "starting");

type Mounted = Awaited<ReturnType<typeof mountRail>>;

const answerWith = (mounted: Mounted, method: "agent.spawn" | "rail.createWorkstream") => {
  mounted.app.handlers[method] = () => SPAWNED;
};

describe("u9 actions", () => {
  it("u9_plus_agent_spawns_at_the_top_level_with_no_selection", async () => {
    const mounted = await mountRail([workstream("g")]);
    answerWith(mounted, "agent.spawn");

    chord("n");

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: null, model: null, effort: null }]));
  });

  it("u9_plus_agent_spawns_under_the_selected_group", async () => {
    const mounted = await mountRail([workstream("g")]);
    answerWith(mounted, "agent.spawn");
    mounted.rail.select("g");

    fireEvent.click(screen.getByLabelText("Add Agent"));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: null, effort: null }]));
  });

  it("u9_plus_agent_spawns_under_the_selected_door", async () => {
    const mounted = await mountRail([door("lead", "idle", "i")]);
    answerWith(mounted, "agent.spawn");
    mounted.rail.select("lead");

    fireEvent.click(screen.getByLabelText("Add Agent"));

    await waitFor(() =>
      expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "lead", model: null, effort: null }]),
    );
  });

  it.each<[string, RailNode]>([
    ["an agent", agent("a", "idle", "i")],
  ])("u9_plus_agent_with_%s_selected_spawns_at_the_top_level", async (_name, selected) => {
    const mounted = await mountRail([selected]);
    answerWith(mounted, "agent.spawn");
    mounted.rail.select("a");

    chord("n");

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: null, model: null, effort: null }]));
  });

  it("u9_the_new_agents_row_becomes_selected_once_the_tree_has_it", async () => {
    const tree: RailNode[] = [workstream("g")];
    const mounted = await mountRail(tree);
    mounted.app.handlers["agent.spawn"] = () => {
      tree.push(SPAWNED);
      mounted.app.emit(event({ name: "rail.changed" }));

      return SPAWNED;
    };

    chord("n");

    await waitFor(() => expect(mounted.rail.selected()).toBe("fresh"));
  });

  it("u9_the_webview_never_adds_a_row_the_tree_does_not_have", async () => {
    const mounted = await mountRail([workstream("g")]);
    answerWith(mounted, "agent.spawn");

    chord("n");
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));

    expect([rowNames(), mounted.rail.selected()]).toEqual([["g"], null]);
  });

  it("u9_plus_workstream_creates_a_root_workstream_even_with_a_selected_workstream", async () => {
    const mounted = await mountRail([workstream("g")]);
    answerWith(mounted, "rail.createWorkstream");
    mounted.rail.select("g");

    fireEvent.click(pinnedAdd());

    await waitFor(() => expect(railCallsTo(mounted.app, "rail.createWorkstream")).toEqual([{ name: "workstream", parent: null }]));
  });

  it("u9_double_clicking_a_name_edits_it_and_enter_renames", async () => {
    const mounted = await mountRail([agent("a", "idle", "i")]);
    mounted.app.handlers["rail.rename"] = () => agent("a", "idle", "i", { name: "renamed" });

    fireEvent.dblClick(screen.getByText("a"));
    const field = screen.getByLabelText("Name");
    fireEvent.input(field, { target: { value: "renamed" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(railCallsTo(mounted.app, "rail.rename")).toEqual([{ id: "a", name: "renamed" }]));
  });

  it("u9_escape_keeps_the_old_name_and_calls_nothing", async () => {
    const mounted = await mountRail([agent("a", "idle", "i")]);

    fireEvent.dblClick(screen.getByText("a"));
    const field = screen.getByLabelText("Name");
    fireEvent.input(field, { target: { value: "renamed" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect([railCallsTo(mounted.app, "rail.rename"), screen.queryByLabelText("Name"), rowNames()]).toEqual([[], null, ["a"]]);
  });

  it("u9_an_empty_name_keeps_the_old_name_and_calls_nothing", async () => {
    const mounted = await mountRail([agent("a", "idle", "i")]);

    fireEvent.dblClick(screen.getByText("a"));
    const field = screen.getByLabelText("Name");
    fireEvent.input(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect([railCallsTo(mounted.app, "rail.rename"), screen.queryByLabelText("Name")]).toEqual([[], null]);
  });

  it("u9_hovering_a_plain_group_shows_promote_which_calls_rail_promote", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["rail.startDoor"] = () => door("g", "idle", "i");

    fireEvent.mouseEnter(rowOf("g"));
    fireEvent.click(screen.getByText(/^start supervisor$/i));

    await waitFor(() => expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([{ id: "g" }]));
  });

  it("u9_promote_is_hidden_until_hover_and_never_on_an_agent", async () => {
    await mountRail([workstream("g"), agent("a", "idle", "i")]);
    const before = screen.queryByText(/^start supervisor$/i);

    fireEvent.mouseEnter(rowOf("a"));

    expect([before, screen.queryByText(/^start supervisor$/i)]).toEqual([null, null]);
  });

  it("u9_a_failed_call_shows_one_ink_line_until_the_next_click", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => {
      throw new RpcError(-32000, "no claude on PATH");
    };

    chord("n");
    const shown = await screen.findByText("no claude on PATH");
    fireEvent.click(rowOf("g"));

    expect([shown.className, screen.queryByText("no claude on PATH")]).toEqual(["ink", null]);
  });

  it("u9_the_failure_line_sits_above_the_actions", async () => {
    const mounted = await mountRail([]);
    mounted.app.handlers["rail.createWorkstream"] = () => {
      throw new RpcError(-32000, "boom");
    };

    fireEvent.click(pinnedAdd());
    const line = await screen.findByText("boom");

    expect(line.compareDocumentPosition(pinnedAdd()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u9_the_failure_line_clears_on_a_click_on_the_fold_triangle", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["rail.createWorkstream"] = () => {
      throw new RpcError(-32000, "boom");
    };

    fireEvent.click(pinnedAdd());
    await screen.findByText("boom");

    fireEvent.click(glyphOf("g"));

    expect(screen.queryByText("boom")).toBeNull();
  });

  it("u9_the_failure_line_clears_on_a_click_on_promote", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["rail.createWorkstream"] = () => {
      throw new RpcError(-32000, "boom");
    };

    mounted.app.handlers["rail.startDoor"] = () => door("g", "idle", "i");

    fireEvent.click(pinnedAdd());
    await screen.findByText("boom");
    fireEvent.mouseEnter(rowOf("g"));

    fireEvent.click(screen.getByText(/^start supervisor$/i));

    expect(screen.queryByText("boom")).toBeNull();
  });

  it("u9_the_failure_line_clears_on_a_click_outside_the_rail", async () => {
    const mounted = await mountRail([]);
    mounted.app.handlers["rail.createWorkstream"] = () => {
      throw new RpcError(-32000, "boom");
    };

    fireEvent.click(pinnedAdd());
    await screen.findByText("boom");

    fireEvent.click(document.body);

    expect(screen.queryByText("boom")).toBeNull();
  });

  it("u9_promote_is_not_shown_on_a_door", async () => {
    await mountRail([door("lead", "idle", "i")]);

    fireEvent.mouseEnter(rowOf("lead"));

    expect(screen.queryByText(/^start supervisor$/i)).toBeNull();
  });

  it("u9_a_collapsed_group_can_still_be_promoted", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.app.handlers["rail.startDoor"] = () => door("g", "idle", "i");
    fireEvent.click(glyphOf("g"));

    fireEvent.mouseEnter(rowOf("g"));
    fireEvent.click(screen.getByText(/^start supervisor$/i));

    await waitFor(() => expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([{ id: "g" }]));
  });

  it("u9_a_double_click_on_plus_agent_spawns_one_agent", async () => {
    const mounted = await mountRail([workstream("g")]);
    let finish: (node: RailNode) => void = () => {};

    mounted.app.handlers["agent.spawn"] = () => new Promise<RailNode>((done) => (finish = done));
    mounted.rail.select("g");
    const button = screen.getByLabelText("Add Agent");

    fireEvent.click(button);
    fireEvent.click(button);
    finish(SPAWNED);

    await waitFor(() => expect(button.matches('[aria-disabled="true"]')).toBe(false));
    expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1);
  });

});

it("u62_creates_one_root_workstream_selects_the_tree_row_and_starts_only_its_door", async () => {
  const tree: RailNode[] = [];
  const mounted = await mountRail(tree);
  mounted.app.handlers["rail.createWorkstream"] = () => workstream("returned-workstream");
  mounted.app.handlers["rail.startDoor"] = () => door("returned-workstream", "working", "starting");
  fireEvent.click(pinnedAdd());
  await waitFor(() => expect(railCallsTo(mounted.app, "rail.createWorkstream")).toEqual([{ name: "workstream", parent: null }]));
  expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([]);
  tree.push(workstream("returned-workstream"));
  mounted.app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(mounted.rail.selected()).toBe("returned-workstream"));
  await waitFor(() => expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([{ id: "returned-workstream" }]));
});


it("u62_failed_start_retries_the_same_workstream_and_leaves_its_terminal_unfocused", async () => {
  const tree: RailNode[] = [];
  const emulators = fakeEmulators();
  const mounted = await mountRail(tree, [], () => null, () => false, { pane: emulators.factory });
  mounted.app.handlers["rail.createWorkstream"] = () => {
    const created = workstream("actual");
    tree.push(created);
    mounted.app.emit(event({ name: "rail.changed" }));

    return created;
  };

  mounted.app.handlers["rail.startDoor"] = () => { throw new RpcError(-32003, "launch failed"); };

  fireEvent.click(pinnedAdd());
  await waitFor(() => expect(mounted.rail.selected()).toBe("actual"));
  await waitFor(() => expect(mounted.rail.doorFailure("actual")).toBe("launch failed"));
  expect(tree).toHaveLength(1);
  let finish: ((node: RailNode) => void) | undefined;
  mounted.app.handlers["rail.startDoor"] = () => new Promise<RailNode>((resolve) => { finish = resolve; });
  const retry = screen.getAllByRole("button", { name: "Retry supervisor" })[0]!;
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(railCallsTo(mounted.app, "rail.startDoor")).toHaveLength(2));
  expect(retry.matches('[aria-disabled="true"]')).toBe(true);
  const live = door("actual", "working", "starting");
  tree.splice(0, 1, live);
  finish!(live);
  // U467: the started Door's own Terminal fills the centre.
  await waitFor(() => expect(document.querySelector(".pane-screen")?.hasAttribute("hidden")).toBe(false));
  expect(railCallsTo(mounted.app, "rail.createWorkstream")).toHaveLength(1);
  expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([{id:"actual"},{id:"actual"}]);
});

it("u9_selecting_a_reopened_workstream_offers_start_without_launching", async () => {
  const mounted = await mountRail([workstream("Reopened", {attempt:"4"})]);
  mounted.rail.select("Reopened");
  expect(screen.getByText(/^start supervisor$/i)).toBeDefined();
  expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([]);
  expect(railCallsTo(mounted.app, "rail.createWorkstream")).toEqual([]);
});

it("a24_a_pending_start_keeps_the_rail_interactive_and_the_pane_size", async () => {
  const mounted = await mountRail([workstream("closed", { attempt: "2" }), workstream("other")]);
  mounted.app.handlers["rail.startDoor"] = () => new Promise<RailNode>(() => {});
  mounted.rail.select("closed");
  const pane = document.querySelector<HTMLElement>(".pane");
  const before = pane?.getAttribute("style") ?? null;

  fireEvent.click(screen.getByText(/^start supervisor$/i));
  await waitFor(() => expect(mounted.rail.doorPending("closed")).toBe(true));
  fireEvent.click(screen.getByText("other"));
  await settled();

  expect(mounted.rail.selected()).toBe("other");
  expect(document.querySelector<HTMLElement>(".pane")?.getAttribute("style") ?? null).toBe(before);
});

it("a24_a_late_failure_shows_the_error_and_retry_door", async () => {
  const mounted = await mountRail([workstream("closed", { attempt: "2" })]);
  mounted.app.handlers["rail.startDoor"] = () => { throw new RpcError(-32003, "closed: no acknowledgement within 8s"); };

  mounted.rail.select("closed");

  fireEvent.click(screen.getByText(/^start supervisor$/i));

  await waitFor(() => expect(mounted.rail.doorFailure("closed")).toBe("closed: no acknowledgement within 8s"));
  expect(screen.getAllByText(/^retry supervisor$/i).length).toBeGreaterThan(0);
  expect(mounted.rail.doorPending("closed")).toBe(false);
});

it("a24_a_start_the_daemon_never_answers_fails_within_the_bound", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  try {
    const mounted = await mountRail([workstream("closed", { attempt: "2" })]);
    mounted.app.handlers["rail.startDoor"] = () => new Promise<RailNode>(() => {});
    mounted.rail.select("closed");

    fireEvent.click(screen.getByText(/^start supervisor$/i));
    await vi.advanceTimersByTimeAsync(10_000);

    await waitFor(() => expect(mounted.rail.doorFailure("closed")).not.toBeNull());
    expect(mounted.rail.doorPending("closed")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("a24_a_start_that_succeeds_shows_the_doors_terminal", async () => {
  const tree: RailNode[] = [workstream("closed", { attempt: "2" })];
  const mounted = await mountRail(tree, [], () => null, () => false, { pane: fakeEmulators().factory });
  mounted.app.handlers["rail.startDoor"] = () => {
    const live = door("closed", "working", "starting");
    tree.splice(0, 1, live);

    return live;
  };

  mounted.rail.select("closed");

  fireEvent.click(screen.getAllByText(/^start supervisor$/i)[0]!);

  await waitFor(() => expect(document.querySelector('[data-terminal="t-closed"]')).not.toBeNull());
  expect(mounted.rail.doorFailure("closed")).toBeNull();
});
