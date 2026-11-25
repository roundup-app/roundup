import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { flush } from "solid-js";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, mode, workstream, node as groupNode } from "../testing/nodes";
import { copy } from "./copy";
import { chooseFooter, mountRail, pinnedAdd, rowOf, settled } from "./railFixture";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
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


type Mounted = Awaited<ReturnType<typeof mount>>;

const footer = async (name: string) => {
  fireEvent.click(await screen.findByRole("button", { name: "Create" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) }));
};

/** Each way the user adds a row; the others (chord, strip, empty Rail, menu bar, pane, Switcher, `⇧⌘N`) end in these two calls. */
const addPaths = {
  "cmd-n": { method: "agent.spawn", run: async () => { fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true }); } },
  "footer-agent": { method: "agent.spawn", run: () => footer("Agent") },
  "footer-workstream": { method: "rail.createWorkstream", run: () => footer("Workstream") },
  "create-workstream": { method: "rail.createWorkstream", run: async (m: Mounted) => { void m.rail().createWorkstream(); } },
} as const;

const created = (m: Mounted, method: string) => m.app.calls.filter(call => call.method === method);

const interventions = {
  press: () => fireEvent.pointerDown(document.querySelector(".rail-scroll") ?? document.body),
  askBar: async () => {
    fireEvent.keyDown(window, { key: "/", code: "Slash", metaKey: true });
    await waitFor(() => expect(document.activeElement?.closest(".ask-bar")).not.toBeNull());
  },
  none: () => undefined,
} as const;


const pathKeys = ["cmd-n", "footer-agent", "footer-workstream", "create-workstream"] as const;

const stepKeys = ["press", "askBar", "none"] as const;

const aCases = pathKeys.flatMap(path => stepKeys.map(step => [path, step] as const));

it.each(aCases)("u7916a_an_added_agent_or_workstream_is_selected_after_a_press_%s_%s", async (path, step) => {
  const m = await mount();
  const { method, run } = addPaths[path];

  m.hold();
  await run(m);
  await waitFor(() => expect(created(m, method)).toHaveLength(1));
  await interventions[step]();
  const focused = document.activeElement;
  m.reveal();
  await waitFor(() => expect(m.rail().selected()).toBe("made"));
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="made"][data-selected]')).not.toBeNull());
  expect(created(m, method)).toHaveLength(1);

  // With no press or focus change in between, an Agent's own Terminal takes focus on arrival (U3756).
  if (step !== "none") expect(document.activeElement).toBe(focused);
});

it.each(["agent", "workstream"] as const)("u7916c_a_newer_pick_wins_and_an_agents_start_never_selects_%s", async path => {
  const m = await mount();
  m.hold();

  await addPaths[path === "agent" ? "cmd-n" : "create-workstream"].run(m);
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
  import: {
    made: agent("made", "idle", "starting", { name: "made one" }),
    setup: (app, made) => { app.handlers["agent.spawn"] = () => made; },
    run: async m => { await m.connected.importing.start(); },
  },
} satisfies Record<string, { made: RailNode; run: (m: Hidden) => Promise<void>; setup?: (app: Hidden["app"], made: RailNode) => void }>;

const bKeys = ["mode", "group", "adopt", "saveAsMode", "import"] as const;

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

it.each(["press", "newer pick"] as const)("u7916b_a_todos_new_workstream_selects_its_row_%s", async step => {
  const { app, connected } = await mountTodos([todo(1, { title: "Ship the login fix" })], true, [workstream("home"), workstream("other")], true);
  let revealed = false;
  const made = workstream("made", { name: "Login" });

  app.handlers["rail.tree"] = () => (revealed ? [workstream("home"), workstream("other"), made] : [workstream("home"), workstream("other")]);
  app.handlers["todo.startWorkstream"] = () => made;
  const name = /^(?:Idle|Blocked|Done) #1 Ship the login fix/;

  // The harness toggles the Unassigned group; the disclosure state outlives the first mount.
  if (!screen.queryByRole("button", { name })) fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-slot="tree-item"][data-branch]') ?? document.body);

  const row = await screen.findByRole("button", { name });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO" });
  fireEvent.click(await screen.findByText("New Workstream…"));
  const dialog = await screen.findByRole("dialog", { name: "New Workstream" });

  fireEvent.input(within(dialog).getByLabelText("Workstream name"), { target: { value: "Login" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(todoCallsTo(app, "todo.startWorkstream")).toHaveLength(1));

  if (step === "press") fireEvent.pointerDown(document.body); else { connected.rail.select("other"); flush(); }

  revealed = true;
  await connected.rail.refresh();
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "made")).toBe(true));
  expect(connected.rail.selected()).toBe(step === "press" ? "made" : "other");
  expect(todoCallsTo(app, "todo.startWorkstream")).toHaveLength(1);
});
