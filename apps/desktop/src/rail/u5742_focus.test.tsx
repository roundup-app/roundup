import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

const row = (id: string) => document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;

const mount = async (nodes: RailNode[] = [agent("ann", "idle", "ready"), agent("dee", "needs-you", "question")]) => {
  const root = createFakeApp();
  root.add("/p");
  const app = root.of("/p");
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => nodes.flatMap(node => node.terminal_id ? [info(node.terminal_id, { owner: node.id })] : []);
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;
  const emulators = fakeEmulators();
  let connected!: ConnectedProject;
  render(() => <App app={root} createEmulator={emulators.factory} clock={() => 0} reducedMotion={() => true} prepareIdle={value => { connected = value; }} />);
  await waitFor(() => expect(row(nodes[0]!.id)).not.toBeNull());

  return { root, app, connected, emulators };
};

const provesChoice = async (m: Awaited<ReturnType<typeof mount>>, id: string) => {
  await waitFor(() => {
    expect(m.connected.rail.selected()).toBe(id);
    expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
    expect(document.activeElement?.getAttribute("data-terminal")).toBe(`t-${id}`);
  });
  expect(m.app.calls.filter(call => ["agent.spawn", "agent.resume", "rail.startDoor", "terminal.open", "terminal.write"].includes(call.method))).toEqual([]);
  m.emulators.made.get(`t-${id}`)!.type(new TextEncoder().encode("marker"));
  await waitFor(() => expect(m.app.calls.filter(call => call.method === "terminal.write").map(call => call.params)).toEqual([{ id: `t-${id}`, data: "bWFya2Vy" }]));
};

it.each(["agent", "workstream", "door", "mode", "redirect", "self-needs-you"])("u5742a_plain_rail_choice_focuses_terminal_%s", async kind => {
  const target = kind === "agent" ? agent("target", "idle", "ready")
    : kind === "mode" ? agent("target", "idle", "ready", { kind: "mode" })
    : kind === "workstream" ? workstream("target", { terminal_id: "t-target" })
    : door("target", kind === "self-needs-you" ? "needs-you" : "idle", "ready");

  const m = await mount([agent("origin", "idle", "ready"), target, ...(kind === "redirect" || kind === "self-needs-you" ? [agent("child", "needs-you", "question", { parent: "target" })] : [])]);
  row("origin").focus();
  fireEvent.click(row("target").querySelector(".name")!);
  await provesChoice(m, kind === "redirect" ? "child" : "target");
});

it("u5742c_rail_enter_focuses_terminal", async () => {
  const m = await mount();
  row("ann").focus();
  fireEvent.keyDown(row("ann"), { key: "Enter" });
  await provesChoice(m, "ann");
});

const key = (key: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...extra });

it.each(["pointer", "enter"])("u5742c_switcher_choice_focuses_terminal_%s", async choice => {
  const m = await mount();
  key("p", { metaKey: true, shiftKey: true });
  const field = await screen.findByRole("combobox");
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "ann" } });
  const option = await screen.findByRole("option", { name: /ann/ });

  if (choice === "pointer") fireEvent.click(option);
  else key("Enter");
  await provesChoice(m, "ann");
});

it.each(["direct", "leader"])("u5742c_attention_choice_focuses_terminal_%s", async choice => {
  const m = await mount();
  screen.getByRole("textbox", { name: "Ask" }).focus();

  if (choice === "leader") { key("k", { metaKey: true }); key("j"); }
  else key("j", { metaKey: true, ctrlKey: true });
  await provesChoice(m, "dee");
});

it("u5742c_native_alert_choice_focuses_terminal", async () => {
  const m = await mount();
  m.root.clickStateAlert("ann");
  await provesChoice(m, "ann");
});

it("u5742c_overview_choice_focuses_terminal", async () => {
  const m = await mount();

  const entry = document.querySelector<HTMLElement>('.overview-entry[data-id="ann"]')
    ?? [...document.querySelectorAll<HTMLElement>('.overview-entry')].find(el => el.textContent?.includes("ann"));

  expect(entry).toBeDefined();
  fireEvent.click(entry!);
  await provesChoice(m, "ann");
});

it("u5742b_modifier_selection_and_arrows_keep_rail_focus", async () => {
  const m = await mount();
  fireEvent.click(row("ann"), { metaKey: true });
  expect(document.activeElement).toBe(row("ann"));
  fireEvent.click(row("dee"), { shiftKey: true });
  expect(document.activeElement).toBe(row("dee"));
  expect(m.connected.rail.selected()).toBeNull();
  key("ArrowUp");
  await waitFor(() => expect(document.activeElement).toBe(row("ann")));
  key("Enter");
  await provesChoice(m, "ann");
});

it("u5742c_held_choice_focuses_terminal", async () => {
  const m = await mount([agent("ann", "working", "busy", { alert_level: "quiet" })]);
  const { status } = await import("../toasts/toastFixture");
  m.app.emit(status("ann", "needs-you"));
  fireEvent.click(await screen.findByRole("button", { name: /held/ }));
  const held = await waitFor(() => { const element = document.querySelector<HTMLElement>(".held-row"); expect(element).not.toBeNull();

 return element!; });
  fireEvent.click(held);
  await provesChoice(m, "ann");
});

it("u5742c_toast_choice_focuses_terminal", async () => {
  const m = await mount([agent("ann", "working", "busy", { alert_level: "all" })]);
  const { status } = await import("../toasts/toastFixture");
  m.app.emit(status("ann", "needs-you"));
  fireEvent.click(await screen.findByRole("button", { name: /ann: Needs you/ }));
  await provesChoice(m, "ann");
});

it("u5742c_inbox_choice_focuses_terminal", async () => {
  const m = await mount();
  m.connected.hideView("workstreams");
  m.connected.showView("attention");
  const entry = await waitFor(() => { const element = document.querySelector<HTMLElement>('[data-row$=":dee"] .inbox-row'); expect(element).not.toBeNull();

 return element!; });
  fireEvent.click(entry);
  key("Enter");
  await provesChoice(m, "dee");
});

it("u5742a_choice_closes_drawer_and_focuses_terminal", async () => {
  const m = await mount();
  m.connected.rail.select("ann");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-ann"));
  m.connected.drawer.open(() => <textarea aria-label="Drawer draft" />, "key");
  const editor = await screen.findByRole("textbox", { name: "Drawer draft" });
  editor.focus();
  fireEvent.click(row("ann"));
  expect(m.connected.drawer.content()).not.toBeNull();
  fireEvent.click(row("dee"));
  await waitFor(() => expect(m.connected.drawer.content()).toBeNull());
  await provesChoice(m, "dee");
});
