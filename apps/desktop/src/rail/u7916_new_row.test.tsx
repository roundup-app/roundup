import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { flush } from "solid-js";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, mode, workstream, node as groupNode } from "../testing/nodes";
import { copy } from "./copy";
import { chooseFooter, mountRail, pinnedAdd, rowOf, settled } from "./railFixture";
import { fakeEmulators } from "../terminal/paneHarness";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

/** The Daemon answers the creating call at once; `rail.tree` shows the row only after `reveal`. */
const mount = async () => {
  const root = createFakeApp();
  root.add("/p");
  const app = root.of("/p");
  let nodes: RailNode[] = [workstream("home"), workstream("other")];
  let hidden: RailNode | null = null;
  let release: (() => void) | null = null;
  let paused = false;
  let connected!: ConnectedProject;

  const make = (node: RailNode) => { hidden = node; };

  app.handlers["rail.tree"] = async () => {
    if (paused) await new Promise<void>(resolve => { release = resolve; });

    return nodes;
  };

  app.handlers["terminal.list"] = () => [];
  app.handlers["agent.spawn"] = () => {
    const made = agent("made", "idle", "starting");

    make(made);

    return made;
  };

  app.handlers["rail.createWorkstream"] = () => {
    const made = workstream("made");

    make(made);

    return made;
  };

  app.handlers["rail.startDoor"] = () => workstream("made");

  render(() => <App app={root} createEmulator={fakeEmulators().factory} clock={() => 0} reducedMotion={() => true} prepareIdle={value => { connected = value; }} />);
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="home"]')).not.toBeNull());

  return {
    app,
    rail: () => connected.rail,
    hold: () => { paused = true; },
    reveal: () => { if (hidden) nodes = [...nodes, hidden]; paused = false; release?.(); },
    appear: (node: RailNode) => { nodes = [...nodes, node]; },
  };
};


const add = { agent: () => fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true }), workstream: (m: Awaited<ReturnType<typeof mount>>) => void m.rail().createWorkstream() };

const created = (m: Awaited<ReturnType<typeof mount>>, method: string) => m.app.calls.filter(call => call.method === method);

it.each(["agent", "workstream"] as const)("u7916a_an_added_agent_or_workstream_is_selected_after_a_press_%s", async path => {
  const m = await mount();
  m.hold();

  if (path === "agent") add.agent(); else add.workstream(m);
  const method = path === "agent" ? "agent.spawn" : "rail.createWorkstream";
  await waitFor(() => expect(created(m, method)).toHaveLength(1));
  fireEvent.pointerDown(document.querySelector(".rail-scroll") ?? document.body);
  const focused = document.activeElement;
  m.reveal();
  await waitFor(() => expect(m.rail().selected()).toBe("made"));
  expect(created(m, method)).toHaveLength(1);
  expect(document.activeElement).toBe(focused);
});

it.each(["agent", "workstream"] as const)("u7916c_a_newer_pick_wins_and_an_agents_start_never_selects_%s", async path => {
  const m = await mount();
  m.hold();

  if (path === "agent") add.agent(); else add.workstream(m);
  await waitFor(() => expect(created(m, path === "agent" ? "agent.spawn" : "rail.createWorkstream")).toHaveLength(1));
  m.rail().select("other");
  flush();
  m.reveal();
  await waitFor(() => expect(m.rail().nodes.some(node => node.id === "made")).toBe(true));
  expect(m.rail().selected()).toBe("other");
});

it("u7916c_a_row_an_agent_starts_never_takes_the_selection", async () => {
  const m = await mount();
  m.rail().select("home");
  flush();
  m.appear(agent("spawned", "idle", "starting"));
  await m.rail().refresh();
  await waitFor(() => expect(m.rail().nodes.some(node => node.id === "spawned")).toBe(true));
  expect(m.rail().selected()).toBe("home");
});

/** The Rail on a fake Daemon whose tree shows `made` only after `reveal`, with the Pane mounted. */
const mountHidden = async (made: RailNode, setup?: (app: Awaited<ReturnType<typeof mountRail>>["app"]) => void) => {
  const tree: RailNode[] = [workstream("home"), workstream("other"), agent("keep", "idle", "", { can_save_as_mode: true })];
  const m = await mountRail(tree, [], () => null, () => true, { pane: fakeEmulators().factory }, [], undefined, setup);
  let hidden = true;
  const visible = () => (hidden ? tree : [...tree, made]);

  m.app.handlers["rail.tree"] = () => visible();

  return { ...m, tree, made, reveal: async () => { hidden = false; await m.rail.refresh(); } };
};

const shownPane = (name: string) => expect(document.querySelector(".pane")?.textContent).toContain(name);

type Hidden = Awaited<ReturnType<typeof mountHidden>>;

const bPaths = {
  mode: {
    made: mode("made", "go", { name: "made one" }),
    setup: (app, made) => { app.handlers["agent.createMode"] = () => made; app.handlers["agent.restartMode"] = () => made; },
    run: async () => {
      await chooseFooter("Mode");
      fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "made one" } });
      fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "go" } });
      fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
    },
  },
  group: {
    made: groupNode("made", { kind: "group", name: "made one" }),
    setup: (app, made) => { app.handlers["rail.group"] = () => made; },
    run: async m => {
      for (const id of ["home", "other"]) { rowOf(id).focus(); fireEvent.click(rowOf(id), { metaKey: true }); await settled(); }

      fireEvent.contextMenu(rowOf("home"));
      await m.app.pickMenu("Group");
    },
  },
  adopt: {
    made: agent("made", "idle", "", { name: "made one" }),
    setup: (app, made) => {
      app.handlers["agent.adoptable"] = () => [{ path: "/w/feature", branch: "feature", ahead: 0, dirty: false, changed: 0, refusal: null }];
      app.handlers["agent.adopt"] = () => made;
    },
    run: async () => {
      fireEvent.click(pinnedAdd());
      fireEvent.click(await screen.findByRole("menuitem", { name: /^Adopt Worktree/ }));
      fireEvent.click(await screen.findByRole("option", { name: /feature/ }));
    },
  },
  saveAsMode: {
    made: mode("made", "go", { name: "made one" }),
    setup: (app, made) => { app.handlers["agent.saveAsMode"] = () => made; },
    run: async m => {
      fireEvent.contextMenu(rowOf("keep"), { clientX: 1, clientY: 1 });
      await m.app.pickMenu(copy.saveAsMode);
      fireEvent.input(await screen.findByRole("textbox", { name: copy.name }), { target: { value: "made one" } });
      fireEvent.click(screen.getByRole("button", { name: copy.saveMode }));
    },
  },
} satisfies Record<string, { made: RailNode; run: (m: Hidden) => Promise<void>; setup?: (app: Hidden["app"], made: RailNode) => void }>;

const bKeys = ["mode", "group", "adopt", "saveAsMode"] as const;

it.each(bKeys)("u7916b_every_other_add_path_selects_its_new_row_%s", async key => {
  const path = bPaths[key];
  const m = await mountHidden(path.made, app => { if ("setup" in path) path.setup(app, path.made); });

  await path.run(m);
  await settled();
  fireEvent.pointerDown(document.querySelector(".rail-scroll") ?? document.body);
  await m.reveal();
  await waitFor(() => expect(m.rail.selected()).toBe("made"));
  shownPane("made");
});

it.each(bKeys)("u7916c_a_newer_pick_wins_after_%s", async key => {
  const path = bPaths[key];
  const m = await mountHidden(path.made, app => { if ("setup" in path) path.setup(app, path.made); });

  await path.run(m);
  await settled();
  m.rail.select("other");
  flush();
  await m.reveal();
  await waitFor(() => expect(m.rail.nodes.some(node => node.id === "made")).toBe(true));
  expect(m.rail.selected()).toBe("other");
});

it.each([["Workstream", "rail.createWorkstream", () => workstream("made", { name: "made one" })]] as const)("u7916a_the_footer_menu_%s_is_selected_after_a_press_and_a_newer_pick_wins", async (kind, method, make) => {
  for (const pick of [false, true]) {
    const m = await mountHidden(make(), app => { app.handlers[method] = () => make(); });

    await chooseFooter(kind);
    await waitFor(() => expect(m.app.calls.filter(call => call.method === method)).toHaveLength(1));
    fireEvent.pointerDown(document.querySelector(".rail-scroll") ?? document.body);

    if (pick) { m.rail.select("other"); flush(); }

    await m.reveal();
    await waitFor(() => expect(m.rail.nodes.some(node => node.id === "made")).toBe(true));
    expect(m.rail.selected()).toBe(pick ? "other" : "made");

    if (!pick) shownPane("made");
    expect(m.app.calls.filter(call => call.method === method)).toHaveLength(1);
    cleanup();
  }
});
