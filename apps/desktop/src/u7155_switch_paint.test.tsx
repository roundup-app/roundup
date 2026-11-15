import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { batch } from "solid-js";
import { App } from "./App";
import { createFakeApp } from "./testing/fakeApp";
import { agent, door, info } from "./testing/nodes";
import { fakeEmulators } from "./terminal/paneHarness";
import { showShelfTab } from "./testing/shelfTabs";
import { endLeader } from "./keys/registry";

afterEach(() => { batch(cleanup); endLeader(); localStorage.clear(); sessionStorage.clear(); });

const PROJECTS = ["/one", "/two", "/three"];

/** Three open Projects, each with an Agent whose Terminal holds output; every emulator construction and write is counted. */
const mount = async () => {
  const app = createFakeApp();

  for (const path of [...PROJECTS].reverse()) app.add(path);

  for (const path of PROJECTS) {
    const name = path.slice(1);
    const nodes = [agent(`${name}-a`, "working", "x", { name: `${name}-agent`, order: 0 }), agent(`${name}-b`, "working", "y", { name: `${name}-other`, order: 1 }), door("r", "idle", "idle", { name: `${name}-door`, order: 2 })];
    const daemon = app.of(path);

    daemon.handlers["rail.tree"] = () => nodes;
    daemon.handlers["terminal.list"] = () => nodes.flatMap(node => node.terminal_id ? [info(node.terminal_id, { owner: node.id })] : []);
    daemon.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 5, data: btoa("hello") });
    daemon.handlers["terminal.resize"] = () => null;
    daemon.handlers["terminal.write"] = () => null;
  }

  const emulators = fakeEmulators();
  const constructed: string[] = [];
  const written = new Map<string, number>();
  const redrawn: string[] = [];

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={(id, copy) => {
    const emulator = emulators.factory(id, copy);
    const write = emulator.write;

    constructed.push(id);

    emulator.redraw = () => { redrawn.push(id); };

    emulator.write = (bytes, parsed) => { written.set(id, (written.get(id) ?? 0) + 1); write(bytes, parsed); };

    return emulator;
  }} />);

  await screen.findByLabelText("Rail", { selector: '[role="tree"]' });

  const visit = async (name: string) => {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${name}-a"]`)).not.toBeNull());
    fireEvent.click(row(`${name}-a`));
    await waitFor(() => expect(shownTerminal()).toBe(`t-${name}-a`));
  };

  for (const name of ["one", "two", "three"]) await visit(name);

  await waitFor(() => expect(written.size).toBe(3));
  fireEvent.click(screen.getByRole("tab", { name: /^one/ }));
  await waitFor(() => expect(shownTerminal()).toBe("t-one-a"));

  return { app, constructed, written, redrawn, tab: (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) }) };
};

const row = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`);

  if (!found) throw new Error(`no Rail row for ${id}`);

  return found;
};

const shownTerminal = () => document.querySelector(".pane-host:not([data-inactive]) .pane-screen [data-terminal]")?.getAttribute("data-terminal");

const snapshot = (mounted: Awaited<ReturnType<typeof mount>>) => ({ constructed: [...mounted.constructed], written: new Map(mounted.written), opened: mounted.app.outputSubscriptions.length });

it("u7155a_a_project_switch_creates_no_terminal_and_replays_nothing", async () => {
  const mounted = await mount();

  const before = snapshot(mounted);

  for (const name of ["two", "one", "three", "two", "one"]) {
    fireEvent.click(mounted.tab(name));
    await waitFor(() => expect(shownTerminal()).toBe(`t-${name}-a`));
    // The first frame already holds the Terminal: it is mounted, not created.
    expect(document.querySelector(".pane-host:not([data-inactive]) .pane-screen [data-terminal]")).not.toBeNull();
  }

  expect(snapshot(mounted)).toEqual(before);
});

it("u7155b_a_rail_selection_creates_no_terminal_and_replays_nothing", async () => {
  const mounted = await mount();
  const select = (id: string) => fireEvent.click(row(id));

  // Every Terminal the Rail can select is shown once, so a second selection is a return.
  for (const id of ["one-b", "r", "one-a"]) {
    select(id);
    await waitFor(() => expect(shownTerminal()).toBe(`t-${id}`));
  }

  const before = snapshot(mounted);

  for (const id of ["one-b", "one-a", "r", "one-a"]) {
    select(id);
    await waitFor(() => expect(shownTerminal()).toBe(`t-${id}`));
  }

  expect(mounted.constructed).toEqual(before.constructed);
  expect(Object.fromEntries(mounted.written)).toEqual(Object.fromEntries(before.written));
});

it("u7155c_a_surface_open_and_close_remount_no_terminal", async () => {
  const mounted = await mount();
  const before = snapshot(mounted);
  const terminal = document.querySelector(".pane-screen [data-terminal]");

  showShelfTab("Todos");
  showShelfTab("Pads");
  await waitFor(() => expect(screen.getByRole("tab", { name: /^Pads/ }).getAttribute("aria-expanded")).toBe("true"));

  expect(document.querySelector(".pane-screen [data-terminal]")).toBe(terminal);
  expect(snapshot(mounted)).toEqual(before);
});

it("ip7168d_a_project_switch_redraws_the_terminal_it_shows_once", async () => {
  const mounted = await mount();

  for (const name of ["two", "one"]) {
    mounted.redrawn.length = 0;
    fireEvent.click(mounted.tab(name));
    await waitFor(() => expect(shownTerminal()).toBe(`t-${name}-a`));

    // xterm resumes a hidden Terminal a task after the switch; this redraw is what the first frame shows.
    expect(mounted.redrawn).toEqual([`t-${name}-a`]);
  }
});
