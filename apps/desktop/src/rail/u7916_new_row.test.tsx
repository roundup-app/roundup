import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { flush } from "solid-js";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, workstream } from "../testing/nodes";
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
  let held = false;
  let connected!: ConnectedProject;

  const make = (node: RailNode) => { hidden = node; };

  app.handlers["rail.tree"] = async () => {
    if (held) await new Promise<void>(resolve => { release = resolve; });

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
    hold: () => { held = true; },
    reveal: () => { if (hidden) nodes = [...nodes, hidden]; held = false; release?.(); },
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
