import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { door, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

const mount = async () => {
  const root = createFakeApp();
  root.add("/p");
  const app = root.of("/p");
  let nodes: RailNode[] = [workstream("home"), workstream("other")];
  let live = false;
  let shell = false;
  let owner = "home";
  let finishStart!: () => void;
  let reveal!: () => void;
  let waiting = false;
  let holdTree = false;
  const emulators = fakeEmulators();
  let connected!: ConnectedProject;
  app.handlers["rail.tree"] = async () => {
    if (holdTree) { waiting = true; await new Promise<void>(resolve => { reveal = resolve; }); }

    return nodes;
  };

  app.handlers["terminal.list"] = () => [...(live ? [info("t-home", { owner })] : []), ...(shell ? [info("shell", { owner: "home" })] : [])];
  app.handlers["terminal.open"] = () => { shell = true;

    return { terminal_id: "shell" };
  };

  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;
  app.handlers["rail.createWorkstream"] = () => { nodes = [...nodes, workstream("made")];

    return nodes[nodes.length - 1]!;
  };

  app.handlers["rail.startDoor"] = ({ id }) => new Promise(resolve => {
    finishStart = () => {
      live = true;
      owner = id;
      const started = door(id, "idle", "ready", { terminal_id: "t-home" });
      nodes = nodes.map(node => node.id === id ? started : node);
      resolve(started);
    };
  });
  render(() => <App app={root} createEmulator={emulators.factory} clock={() => 0} reducedMotion={() => true} prepareIdle={value => { connected = value; }} />);
  await screen.findByRole("textbox", { name: "Ask" });
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="home"]')).not.toBeNull());

  return { app, emulators, connected, hold: () => { holdTree = true; }, waiting: () => waiting, reveal: () => { holdTree = false; reveal(); }, finish: () => finishStart() };
};

it.each(["rail", "ask", "other-row"])("u4011_new_workstream_selection_preserves_newer_focus_%s", async choice => {
  const m = await mount();
  m.hold();
  void m.connected.rail.createWorkstream();
  await waitFor(() => expect(m.waiting()).toBe(true));
  const ask = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
  const rail = document.querySelector<HTMLElement>(".rail-scroll")!;
  const other = document.querySelector<HTMLElement>('.rail-row[data-id="other"]')!;

  if (choice === "ask") { fireEvent.pointerDown(ask); ask.focus(); }
  else if (choice === "other-row") { fireEvent.pointerDown(other); fireEvent.click(other.querySelector(".name")!); other.focus(); }
  else fireEvent.pointerDown(rail);
  const newer = document.activeElement;
  const terminalFocuses: EventTarget[] = [];
  const observe = (event: FocusEvent) => { if (event.target instanceof HTMLElement && event.target.hasAttribute("data-terminal")) terminalFocuses.push(event.target); };

  document.addEventListener("focusin", observe);
  m.reveal();
  await waitFor(() => expect(m.app.calls.filter(call => call.method === "rail.startDoor")).toHaveLength(1));
  m.finish();
  // rail.startDoor refreshes the tree after its reply; the live row acknowledges that reconciliation.
  await waitFor(() => expect(m.connected.rail.nodes.find(node => node.id === "made")?.terminal_id).toBe("t-home"));

  if (choice !== "other-row") await waitFor(() => expect(m.emulators.made.get("t-home")?.host).toBeTruthy());
  await waitFor(() => expect(m.connected.rail.doorPending("made")).toBe(false));
  expect(m.connected.rail.selected()).toBe(choice === "other-row" ? "other" : "made");
  document.removeEventListener("focusin", observe);
  expect(terminalFocuses).toEqual([]);
  expect(document.activeElement).toBe(newer);

  if (choice === "ask") {
    fireEvent.input(ask, { target: { value: "u4011 exact marker" } });
    expect(ask.value).toBe("u4011 exact marker");
    expect(document.activeElement).toBe(ask);
  }

  expect(m.app.calls.filter(call => call.method === "rail.createWorkstream")).toHaveLength(1);
  expect(m.app.calls.filter(call => call.method === "rail.startDoor").map(call => call.params)).toEqual([expect.objectContaining({ id: "made" })]);
  expect(m.app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it.each(["origin", "body"])("u3756c_returning_to_origin_or_body_does_not_rearm_old_focus_%s", async ending => {
  const m = await mount();
  m.connected.rail.select("home");
  await waitFor(() => expect(document.querySelector(".pane-action")).not.toBeNull());
  const origin = document.querySelector<HTMLElement>('.rail-row[data-id="home"]')!;
  origin.focus();
  fireEvent.click(document.querySelector(".pane-action")!);
  await waitFor(() => expect(m.app.calls.filter(call => call.method === "rail.startDoor")).toHaveLength(1));
  fireEvent.keyDown(document.activeElement!, { key: "t", code: "KeyT", metaKey: true });
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));

  if (ending === "origin") origin.focus();
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const expected = document.activeElement;
  m.finish();
  await waitFor(() => expect(m.emulators.made.get("t-home")?.host).toBeTruthy());
  await waitFor(() => expect(m.connected.rail.doorPending("home")).toBe(false));
  expect(document.activeElement).toBe(expected);
  expect(m.app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});
