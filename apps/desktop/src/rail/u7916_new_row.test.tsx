import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { RequestedApp } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import {
  agent,
  event,
  mode,
  workstream,
  node as groupNode,
} from "../testing/nodes";
import { todo } from "../todos/testHarness";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import type { Actor } from "@contracts/Actor";
import { openProjectPage } from "../testing/menuProbe";
import { fakeEmulators } from "../terminal/paneHarness";
import {
  openSwitcher,
  field as switcherField,
  switcherKey,
} from "../switcher/switcherFixture";
import { copy } from "./copy";
import { chooseFooter, rowOf, settled } from "./railFixture";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

const MADE = { name: "made one" };

/** The App on a fake Daemon. A creating call answers at once with the row `made`, which `rail.tree` shows only after `reveal`. */
const mount = async (
  options: { empty?: boolean; plain?: boolean; todos?: true } = {},
) => {
  const root = createFakeApp();
  root.add("/p");
  const app = root.of("/p");

  let nodes: RailNode[] = options.empty
    ? []
    : [
        workstream("home"),
        workstream("other"),
        agent("keep", "idle", "", { can_save_as_mode: true }),
      ];

  let hidden: RailNode | null = null;
  let connected!: ConnectedProject;

  const make = <Node extends RailNode>(node: Node): Node => {
    hidden = node;

    return node;
  };

  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => [];
  app.handlers["agent.spawn"] = () =>
    make(agent("made", "idle", "starting", MADE));
  app.handlers["rail.createWorkstream"] = () => make(workstream("made", MADE));
  app.handlers["rail.startDoor"] = () => workstream("made", MADE);
  app.handlers["agent.createMode"] = () => make(mode("made", "go", MADE));
  app.handlers["agent.restartMode"] = () => mode("made", "go", MADE);
  app.handlers["agent.saveAsMode"] = () => make(mode("made", "go", MADE));
  app.handlers["rail.group"] = () =>
    make(groupNode("made", { kind: "group", ...MADE }));
  app.handlers["agent.adoptable"] = () => [
    {
      path: "/w/feature",
      branch: "feature",
      ahead: 0,
      dirty: false,
      changed: 0,
      refusal: null,
    },
  ];
  app.handlers["agent.adopt"] = () => make(agent("made", "idle", "", MADE));

  if (options.todos) {
    const store: TodoStore = { todos: [todo(1, { title: "Ship it" })] };

    Object.assign(
      app.handlers,
      todoHandlers(store, (announced) => app.emit(event(announced))),
      { "todo.startWorkstream": () => make(workstream("made", MADE)) },
    );
  }

  const Mounted = options.plain ? App : RequestedApp;
  render(() => (
    <Mounted
      app={root}
      createEmulator={fakeEmulators().factory}
      clock={() => 0}
      reducedMotion={() => true}
      initialShelfOpen
      prepareIdle={(value) => {
        connected = value;
      }}
    />
  ));
  await waitFor(() => expect(connected).toBeDefined());

  if (!options.empty)
    await waitFor(() =>
      expect(
        document.querySelector('.rail-row[data-id="home"]'),
      ).not.toBeNull(),
    );

  return {
    app,
    root,
    make,
    rail: () => connected.rail,
    shown: (id: string) => document.querySelector(`.rail-row[data-id="${id}"]`),
    appear: async (node: RailNode, actor?: Actor) => {
      nodes = [...nodes, node];
      app.emit(
        actor
          ? { ...event({ name: "rail.changed" }), actor }
          : event({ name: "rail.changed" }),
      );
      await waitFor(() =>
        expect(
          document.querySelector(`.rail-row[data-id="${node.id}"]`),
        ).not.toBeNull(),
      );
    },
    reveal: async () => {
      if (hidden) {
        nodes = [...nodes, hidden];
        app.emit(event({ name: "rail.changed" }));
        await waitFor(() =>
          expect(
            document.querySelector('.rail-row[data-id="made"]'),
          ).not.toBeNull(),
        );
      }
    },
    calls: (method: string) =>
      app.calls.filter((call) => call.method === method),
  };
};

type Mounted = Awaited<ReturnType<typeof mount>>;

const required = <Value,>(value: Value | null | undefined): Value => {
  if (value === null || value === undefined)
    throw new Error("expected a value");

  return value;
};

const asks = async () => {
  fireEvent.keyDown(document.body, { key: "/", code: "Slash", metaKey: true });

  const bar = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Ask",
  });

  fireEvent.pointerDown(bar);
  bar.focus();
};

/** What the user does between the add and the row's appearance. None is a pick, so none cancels the selection or moves focus. */
const interventions = {
  press: () => {
    fireEvent.pointerDown(
      document.querySelector(".rail-scroll") ?? document.body,
    );
  },
  ask: asks,
  /** Only a path a menu started has one: the menu closing hands focus back to its trigger. */
  menu: () => waitFor(() => expect(screen.queryByRole("menu")).toBeNull()),
};

type Add = {
  creates: string;
  menu?: true;
  todos?: true;
  /** The page this path opens covers the Ask bar. */
  noAsk?: true;
  empty?: boolean;
  plain?: boolean;
  run: (m: Mounted) => Promise<void> | void;
};

const emptyRail = (label: string) => () => {
  fireEvent.click(
    within(screen.getByRole("group", { name: "No Agents yet" })).getByRole(
      "button",
      { name: label },
    ),
  );
};

const aPaths = {
  "agent ⌘N": {
    creates: "agent.spawn",
    run: () => {
      fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true });
    },
  },
  "agent footer menu": {
    creates: "agent.spawn",
    menu: true,
    run: () => chooseFooter("Agent"),
  },
  "agent empty Rail": {
    creates: "agent.spawn",
    empty: true,
    run: emptyRail("New Agent"),
  },
  "agent menu bar": {
    creates: "agent.spawn",
    run: () => openProjectPage("action:chord:⌘N", "/p"),
  },
  "agent pane": {
    creates: "agent.spawn",
    plain: true,
    run: async () => {
      fireEvent.click(await screen.findByRole("button", { name: "New Agent" }));
    },
  },
  "agent ⇧⌘N prompt": {
    creates: "agent.spawn",
    run: async () => {
      fireEvent.keyDown(document, {
        key: "n",
        code: "KeyN",
        metaKey: true,
        shiftKey: true,
      });
      const task = await screen.findByLabelText<HTMLTextAreaElement>(copy.task);
      fireEvent.input(task, { target: { value: "go" } });
      fireEvent.keyDown(task, { key: "Enter" });
    },
  },
  "workstream footer menu": {
    creates: "rail.createWorkstream",
    menu: true,
    run: () => chooseFooter("Workstream"),
  },
  "workstream ⌥⌘N": {
    creates: "rail.createWorkstream",
    run: () => {
      fireEvent.keyDown(window, {
        key: "n",
        code: "KeyN",
        metaKey: true,
        altKey: true,
      });
    },
  },
  "workstream strip": {
    creates: "rail.createWorkstream",
    run: () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Collapse the Rail" }),
      );
      fireEvent.click(required(document.querySelector(".rail-strip-add")));
    },
  },
  "workstream empty Rail": {
    creates: "rail.createWorkstream",
    empty: true,
    run: emptyRail("New Workstream"),
  },
  "workstream Switcher": {
    creates: "rail.createWorkstream",
    run: async () => {
      openSwitcher();
      await waitFor(() => expect(switcherField()).not.toBeNull());
      fireEvent.input(required(switcherField()), {
        target: { value: "zzz plan" },
      });
      await waitFor(() =>
        expect(required(switcherField()).value).toBe("zzz plan"),
      );
      switcherKey("Enter");
      await waitFor(() => expect(switcherField()).toBeNull());
    },
  },
} satisfies Record<string, Add>;

const shownPane = () =>
  waitFor(() =>
    expect(
      document.querySelector(
        '.pane [data-agent="made"], .pane-group[aria-label="made one"]',
      ),
    ).not.toBeNull(),
  );

/** U7916a, U7916b: after `intervene`, the row the add made is selected once it appears, its pane shows, the add ran once and focus stays where `intervene` left it. */
const selectsAfter = async (
  path: Add,
  intervention: keyof typeof interventions,
  keepsFocus: boolean,
) => {
  const m = await mount(path);
  await path.run(m);
  await waitFor(() => expect(m.calls(path.creates)).toHaveLength(1));
  await interventions[intervention]();
  await settled();
  const focused = document.activeElement;
  await m.reveal();
  await waitFor(() => expect(m.rail().selected()).toBe("made"));
  await shownPane();
  await settled();
  expect(m.calls(path.creates)).toHaveLength(1);

  // The menu a footer pick closes hands focus to its trigger, and arrival focus (U3756) then goes to the new row; no press or focus change is there to keep it.
  if (keepsFocus && intervention !== "menu")
    expect(document.activeElement).toBe(focused);
};

const cells = (paths: Readonly<Record<string, Add>>) =>
  Object.entries(paths).flatMap(([name, path]) =>
    // SAFETY: `Object.keys` of `interventions` lists exactly its own names.
    (Object.keys(interventions) as (keyof typeof interventions)[])
      .filter((intervention) => intervention !== "menu" || path.menu)
      .filter((intervention) => intervention !== "ask" || !path.noAsk)
      .map((intervention) => ({ name, path, intervention })),
  );

it.each(cells(aPaths))(
  "u7916a_an_added_agent_or_workstream_is_selected_after_a_press: $name, $intervention",
  ({ path, intervention }) => selectsAfter(path, intervention, true),
);

const bPaths = {
  Mode: {
    creates: "agent.createMode",
    menu: true,
    run: async () => {
      await chooseFooter("Mode");
      fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
        target: { value: MADE.name },
      });
      fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), {
        target: { value: "go" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
    },
  },
  Group: {
    creates: "rail.group",
    run: async (m) => {
      for (const name of ["home", "other"]) {
        rowOf(name).focus();
        fireEvent.click(rowOf(name), { metaKey: true });
        await settled();
      }

      fireEvent.contextMenu(rowOf("home"));
      await m.root.pickMenu("Group");
    },
  },
  "Adopt Worktree": {
    creates: "agent.adopt",
    menu: true,
    run: async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Create" }));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /^Adopt Worktree/ }),
      );
      fireEvent.click(await screen.findByRole("option", { name: /feature/ }));
    },
  },
  "Save as Mode": {
    creates: "agent.saveAsMode",
    run: async (m) => {
      fireEvent.contextMenu(rowOf("keep"), { clientX: 1, clientY: 1 });
      await m.root.pickMenu(copy.saveAsMode);
      fireEvent.input(await screen.findByRole("textbox", { name: copy.name }), {
        target: { value: MADE.name },
      });
      fireEvent.click(screen.getByRole("button", { name: copy.saveMode }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  },
  "Todo's New Workstream": {
    creates: "todo.startWorkstream",
    todos: true,
    run: async () => {
      const group = await waitFor(() => {
        const found = document.querySelector<HTMLElement>(
          '[data-shelf-group="unassigned"] [data-slot="tree-item"][data-branch]',
        );

        expect(found).not.toBeNull();

        return required(found);
      });

      fireEvent.click(group);
      group.blur();
      const row = await screen.findByRole("button", { name: /#1 Ship it/ });
      row.focus();
      fireEvent.keyDown(row, { key: "o", code: "KeyO" });
      fireEvent.click(
        within(await screen.findByRole("menu")).getByText("New Workstream…"),
      );
      fireEvent.click(
        within(
          await screen.findByRole("dialog", { name: "New Workstream" }),
        ).getByRole("button", { name: "Create" }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  },
  "import listing Agent": {
    creates: "agent.spawn",
    noAsk: true,
    run: async (m) => {
      openProjectPage("import-work", "/p");
      fireEvent.click(
        await screen.findByRole("button", { name: "Start import Agent" }),
      );
      await waitFor(() => expect(m.calls("agent.spawn")).toHaveLength(1));
    },
  },
} satisfies Record<string, Add>;

it.each(cells(bPaths))(
  "u7916b_every_other_add_path_selects_its_new_row: $name, $intervention",
  ({ path, intervention }) => selectsAfter(path, intervention, false),
);

const named = (paths: Readonly<Record<string, Add>>) =>
  Object.entries(paths).map(([name, path]) => ({ name, path }));

const USER_PICK = "other";

/** U7916c: the user picks `other` after the add and before the new row appears. */
it.each(named({ ...aPaths, ...bPaths }))(
  "u7916c_a_newer_pick_wins_and_an_agents_start_never_selects: a pick after $name",
  async ({ path }) => {
    const m = await mount(path);
    await path.run(m);
    await waitFor(() => expect(m.calls(path.creates)).toHaveLength(1));

    // An empty Rail has no other row yet: one arrives as the Daemon's own change.
    if (!m.shown(USER_PICK)) await m.appear(workstream(USER_PICK));
    const row = required(m.shown(USER_PICK));
    fireEvent.pointerDown(row);
    fireEvent.click(row.querySelector(".name") ?? row);
    await waitFor(() => expect(m.rail().selected()).toBe(USER_PICK));
    await m.reveal();
    await settled();
    expect(m.rail().selected()).toBe(USER_PICK);
    expect(m.calls(path.creates)).toHaveLength(1);
  },
);

const AGENT: Actor = { kind: "agent", id: "keep", parent: null };

/** What the Daemon shows when an Agent starts a row: a `rail.changed` it caused, and the row. */
const started = {
  agent_spawn: () => agent("started", "idle", "starting"),
  rail_createWorkstream: () => workstream("started"),
  "project.start": () => agent("started", "idle", "starting"),
};

// SAFETY: `Object.keys` of `started` lists exactly its own names.
it.each(Object.keys(started) as (keyof typeof started)[])(
  "u7916c_a_newer_pick_wins_and_an_agents_start_never_selects: the row an Agent starts with %s",
  async (how) => {
    const m = await mount();
    fireEvent.click(required(required(m.shown("home")).querySelector(".name")));
    await waitFor(() => expect(m.rail().selected()).toBe("home"));

    if (how === "project.start") {
      m.app.handlers["agent.spawn"] = () => started[how]();

      const reply = await m.root.requestAction({
        id: 7,
        method: "project.start",
        params: {
          path: "/p",
          source: "/p",
          agent: { id: "keep", name: "keep" },
          kind: "agent",
          name: "started",
          prompt: "go",
        },
      });

      expect(reply).not.toHaveProperty("error");
      expect(m.calls("agent.spawn")).toHaveLength(1);
    }

    await m.appear(started[how](), AGENT);
    await settled();
    expect(m.shown("started")).not.toBeNull();
    expect(m.rail().selected()).toBe("home");
  },
);
