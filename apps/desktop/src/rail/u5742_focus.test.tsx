import { TargetText } from "../terminal/TargetText";
import { ConnectedProjectContext } from "../state/connectedProject";
import { batch, createSignal } from "solid-js";
import { RpcError } from "../app/seam";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info, workstream } from "../testing/nodes";
import { lazyEmulators } from "../terminal/lazyEmulator";
import { fakeEmulators } from "../terminal/paneHarness";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";

afterEach(() => { batch(cleanup); localStorage.clear(); sessionStorage.clear(); });

const row = (id: string) => document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;

const mount = async (nodes: RailNode[] = [agent("ann", "idle", "ready"), agent("dee", "needs-you", "question")], loading = false, other = false) => {
  const root = createFakeApp();

  if (other) root.add("/other");
  root.add("/p");
  const app = root.of("/p");
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => nodes.flatMap(node => node.terminal_id ? [info(node.terminal_id, { owner: node.id })] : []);
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;

  if (other) {
    const second = root.of("/other");
    second.handlers["rail.tree"] = () => [agent("second", "needs-you", "question")];
    second.handlers["terminal.list"] = () => [info("t-second", { owner: "second" })];
    second.handlers["terminal.snapshot"] = app.handlers["terminal.snapshot"];
    second.handlers["terminal.resize"] = () => null;
    second.handlers["terminal.write"] = () => null;
  }

  const emulators = fakeEmulators();
  const load = Promise.withResolvers<typeof emulators.factory>();
  const factory = loading ? lazyEmulators(() => load.promise) : emulators.factory;
  const connections = new Map<string, ConnectedProject>();
  let connected!: ConnectedProject;
  render(() => <App app={root} createEmulator={factory} clock={() => 0} reducedMotion={() => true} prepareIdle={value => { connections.set(value.project.path, value);

 if (value.project.path === "/p") connected = value; }} />);
  await waitFor(() => expect(row(nodes[0]!.id)).not.toBeNull());

  return { root, app, connected, emulators, connections, finish: () => load.resolve(emulators.factory) };
};

const provesChoice = async (m: Awaited<ReturnType<typeof mount>>, id: string) => {
  await waitFor(() => {
    expect(m.connected.rail.selected()).toBe(id);
    expect([...document.querySelectorAll<HTMLElement>('.rail-row[data-selected="true"]')].map(row => row.dataset.id)).toEqual([id]);
    expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
    expect(document.activeElement?.getAttribute("data-terminal")).toBe(`t-${id}`);
  });
  expect(m.app.calls.filter(call => ["agent.spawn", "agent.resume", "rail.startDoor", "terminal.open", "terminal.write"].includes(call.method))).toEqual([]);
  m.emulators.made.get(`t-${id}`)!.type(new TextEncoder().encode("marker"));
  await waitFor(() => expect(m.app.calls.filter(call => call.method === "terminal.write").map(call => call.params)).toEqual([{ id: `t-${id}`, data: "bWFya2Vy" }]));
};

it.each(["agent", "workstream", "door", "mode", "redirect", "self-needs-you"])("u5742a_plain_rail_choice_focuses_terminal_%s", async kind => {
  const target = kind === "agent" ? agent("target", "idle", "ready")
    : kind === "mode" ? door("target", "idle", "ready", { opening_prompt: "review this" })
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

const key = (key: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, code: key === "/" ? "Slash" : key.length === 1 ? `Key${key.toUpperCase()}` : key, ...extra });

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
  document.querySelector<HTMLElement>(".rail-row")!.focus();

  if (choice === "leader") { key("k", { metaKey: true }); key("j"); }
  else key("j", { metaKey: true, ctrlKey: true });
  await provesChoice(m, "dee");
});

it("u5742c_overview_choice_focuses_terminal", async () => {
  const m = await mount();

  const entry = await waitFor(() => { const element = document.querySelector<HTMLElement>('.overview-entry[data-overview-item^="dee:"]'); expect(element).not.toBeNull();

 return element!; });

  fireEvent.click(entry);
  await provesChoice(m, "dee");
});

it("u5742b_modifier_selection_and_arrows_keep_rail_focus", async () => {
  const m = await mount(["ann", "bea", "cee", "dee"].map(id => agent(id, "idle", "ready")));
  const selected = () => [...document.querySelectorAll<HTMLElement>('.rail-row[data-selected="true"]')].map(row => row.dataset.id);
  fireEvent.click(row("ann"), { metaKey: true });
  expect(selected()).toEqual(["ann"]);
  expect(document.activeElement).toBe(row("ann"));
  fireEvent.click(row("cee"), { metaKey: true });
  expect(selected()).toEqual(["ann", "cee"]);
  expect(document.activeElement).toBe(row("cee"));
  fireEvent.click(row("ann"), { metaKey: true });
  expect(selected()).toEqual(["cee"]);
  expect(document.activeElement).toBe(row("ann"));
  fireEvent.click(row("dee"), { shiftKey: true });
  expect(selected()).toEqual(["ann", "bea", "cee", "dee"]);
  expect(document.activeElement).toBe(row("dee"));
  fireEvent.click(row("bea"), { shiftKey: true });
  expect(selected()).toEqual(["ann", "bea"]);
  expect(document.activeElement).toBe(row("bea"));
  expect(m.connected.rail.selected()).toBeNull();
  expect(m.app.calls.filter(call => ["agent.spawn", "agent.resume", "terminal.open", "terminal.write"].includes(call.method))).toEqual([]);
  key("ArrowUp");
  await waitFor(() => expect(document.activeElement).toBe(row("ann")));
  key("ArrowDown");
  await waitFor(() => expect(document.activeElement).toBe(row("bea")));
  key("Enter");
  await provesChoice(m, "bea");
});

it("u5742c_group_child_choice_focuses_terminal", async () => {
  const group = { ...workstream("group"), kind: "group" as const, status: null, work: null };
  const m = await mount([group, agent("ann", "idle", "ready", { parent: "group" })]);
  fireEvent.click(row("group"));
  fireEvent.click(await screen.findByRole("button", { name: "ann" }));
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

  fireEvent.click(entry.closest(".inbox-head")!.querySelector(".inbox-actions button")!);
  await provesChoice(m, "dee");
});

it("u5742a_choice_closes_drawer_and_focuses_terminal", async () => {
  const m = await mount();
  m.connected.rail.select("ann");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-ann"));
  m.connected.drawer.open(() => <textarea aria-label="Drawer draft" />, "key");
  const editor = await screen.findByLabelText("Drawer draft", { selector: "textarea" });
  editor.focus();
  fireEvent.click(row("ann"));
  expect(m.connected.drawer.content()).not.toBeNull();
  fireEvent.click(row("dee"));
  await waitFor(() => expect(m.connected.drawer.content()).toBeNull());
  await provesChoice(m, "dee");
});

it.each(["click", "enter", "attention", "switcher", "native-alert"])("u5742d_choice_readiness_respects_newer_focus_%s", async path => {
  const m = await mount(undefined, true);

  if (path === "click") fireEvent.click(row("dee"));
  else if (path === "enter") { row("dee").focus(); key("Enter"); }
  else if (path === "attention") key("j", { ctrlKey: true, metaKey: true });
  else if (path === "native-alert") m.root.clickStateAlert("dee");
  else {
    key("p", { metaKey: true, shiftKey: true });
    const field = await screen.findByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.input(field, { target: { value: "dee" } });
    fireEvent.click(await screen.findByRole("option", { name: /dee/ }));
  }

  await waitFor(() => expect(m.connected.rail.selected()).toBe("dee"));
  key("/", { metaKey: true });
  const ask = await screen.findByLabelText<HTMLTextAreaElement>("Ask", { selector: "textarea" });
  fireEvent.pointerDown(ask); ask.focus();
  fireEvent.input(ask, { target: { value: "newer draft" } });
  m.finish();
  await waitFor(() => expect(m.emulators.made.get("t-dee")?.host).toBeTruthy());
  expect(document.activeElement).toBe(ask);
  expect(ask.value).toBe("newer draft");
  m.emulators.made.get("t-dee")!.type(new TextEncoder().encode("wrong"));
  expect(m.app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
  key("Escape");
  await waitFor(() => expect(document.activeElement).not.toBe(ask));
  fireEvent.pointerDown(row("dee"));
  fireEvent.click(row("dee"));
  await provesChoice(m, "dee");
});

it("u5742d_choice_takes_focus_when_terminal_becomes_ready", async () => {
  const m = await mount(undefined, true);
  fireEvent.click(row("dee"));
  await waitFor(() => expect(m.connected.rail.selected()).toBe("dee"));
  m.finish();
  await provesChoice(m, "dee");
});

it("u5742a_reselect_replaces_modifier_selection_and_focuses_terminal", async () => {
  const m = await mount();
  fireEvent.click(row("ann"), { metaKey: true });
  fireEvent.click(row("dee"), { metaKey: true });
  fireEvent.click(row("ann"));
  await provesChoice(m, "ann");
  row("ann").focus();
  m.app.calls.length = 0;
  fireEvent.click(row("ann"));
  await provesChoice(m, "ann");
});

it.each(["agent", "workstream"] as const)("u5742c_authorized_native_link_choice_focuses_terminal_%s", async kind => {
  const destination = kind === "agent" ? agent("ann", "idle", "ready") : door("ann", "idle", "ready");
  const m = await mount([destination]);
  m.app.handlers["link.read"] = () => kind === "agent"
    ? { kind, id: "ann", node: destination, digest: null }
    : { kind, id: "ann", node: destination, children: [] };
  const url = `roundup://${kind}/ann?project=project-0000000000000000`;
  m.root.nativeOpen({ kind: "link", url });
  await provesChoice(m, "ann");
  expect(m.app.calls.filter(call => call.method === "link.read").map(call => call.params)).toEqual([{ url }]);
});

it.each(["fold", "add-agent", "door-action", "menu"])("u5742b_controls_do_not_activate_the_row_%s", async control => {
  const m = await mount([agent("ann", "idle", "ready"), door("mode", "idle", "ready", { opening_prompt: "review this" }), agent("child", "idle", "ready", { parent: "mode" })]);
  m.connected.rail.select("ann");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-ann"));
  const { copy } = await import("./copy");
  m.app.handlers["agent.spawn"] = () => new Promise(() => {});
  m.app.handlers["workstream.restart"] = () => new Promise(() => {});
  const label = control === "fold" ? copy.collapse : control === "add-agent" ? copy.addAgentLabel : control === "door-action" ? copy.restart : copy.rowActions;
  const button = [...row("mode").querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === label)!;
  expect(button).toBeDefined();
  fireEvent.pointerDown(button); button.focus(); fireEvent.click(button);
  expect(m.connected.rail.selected()).toBe("ann");
  expect(document.activeElement?.closest(".pane-screen")).toBeNull();

  if (control === "fold") expect(m.connected.rail.collapsed().has("mode")).toBe(true);

  if (control === "menu") { await waitFor(() => expect(m.app.shownMenus).toHaveLength(1)); await m.app.closeMenu(); }

  if (control === "add-agent" || control === "door-action") await waitFor(() => expect(m.app.calls.filter(call => call.method === (control === "add-agent" ? "agent.spawn" : "workstream.restart"))).toHaveLength(1));
  expect(m.app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it("u5742c_ask_result_choice_focuses_terminal", async () => {
  const m = await mount([door("ann", "idle", "ready")]);
  m.app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "ask.changed", data: { ask: { id: "asked", at: 1n, text: "review this", parts: [{ text: "review this", placement: { kind: "routed", workstream: "ann" }, state: "typed" }] } } });
  key("/", { metaKey: true });
  fireEvent.click(await screen.findByRole("button", { name: /review this/ }));
  await provesChoice(m, "ann");
});

it.each(["header", "native-alert"])("u5742c_cross_project_choice_focuses_terminal_%s", async path => {
  const m = await mount(undefined, false, true);
  await waitFor(() => expect(document.querySelector('.project-tab[data-path="/other"] .tab-mark')).not.toBeNull());

  if (path === "native-alert") m.root.clickStateAlert("second");
  else {
    const mark = await waitFor(() => { const element = document.querySelector<HTMLElement>('.project-tab[data-path="/other"] .tab-mark'); expect(element).not.toBeNull();

 return element!; });

    fireEvent.click(mark);
  }

  await waitFor(() => expect(m.connections.has("/other")).toBe(true));
  await provesChoice({ ...m, app: m.root.of("/other"), connected: m.connections.get("/other")! }, "second");
});

it("u5742b_native_ctrl_click_does_not_activate_the_row", async () => {
  const m = await mount();
  row("ann").focus();
  fireEvent.pointerDown(row("dee"), { button: 0, ctrlKey: true });
  fireEvent.contextMenu(row("dee"), { ctrlKey: true });
  await waitFor(() => expect(m.app.shownMenus).toHaveLength(1));
  await m.app.closeMenu();
  fireEvent.click(row("dee"));
  expect(m.connected.rail.selected()).toBeNull();
  expect(document.activeElement?.closest(".pane-screen")).toBeNull();
  expect(m.app.calls.filter(call => ["agent.spawn", "agent.resume", "terminal.open", "terminal.write"].includes(call.method))).toEqual([]);
});

it.each(["agent", "door"] as const)("u5742c_native_menu_choice_focuses_terminal_%s", async kind => {
  const m = await mount([(kind === "agent" ? agent : door)("ann", "needs-you", "question")]);
  await waitFor(() => expect(m.root.menuBar).not.toBeNull());
  m.root.menuBarAction({ kind: "agent", path: "/p", agent: "ann" });
  await provesChoice(m, "ann");
});

const mountTextLink = async (kind: "agent" | "workstream") => {
  const app = createFakeApp();
  app.add("/project");
  const target = kind === "agent" ? agent("chosen", "idle", "ready") : door("chosen", "idle", "ready");
  app.handlers["rail.tree"] = () => [target, agent("other", "idle", "ready")];
  app.handlers["terminal.list"] = () => [info("t-chosen", { owner: "chosen" }), info("t-other", { owner: "other" })];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;
  app.handlers["link.read"] = () => kind === "agent" ? { kind, id: "chosen", node: target, digest: null } : { kind, id: "chosen", node: target, children: [] };

  const emulators = fakeEmulators();
  let connected!: ConnectedProject;
  render(() => <App app={app} createEmulator={emulators.factory} reducedMotion={() => true} clock={() => 0} prepareIdle={open => { connected = open;  }} />);
  await waitFor(() => expect(connected).toBeDefined());
  const url = `roundup://${kind}/chosen?project=project-0000000000000000`;
  const [failure, setFailure] = createSignal<string | null>(null);
  render(() => <ConnectedProjectContext.Provider value={connected}><TargetText objectLinks text={`Choose ${url}.`} base="/project" onFailure={setFailure} /><span role="alert">{failure()}</span></ConnectedProjectContext.Provider>);
  const link = await screen.findByRole("link", { name: url });

  return { app, connected, emulators, link, url };
};

it.each(["agent", "workstream"] as const)("u5742c_message_link_choice_focuses_terminal_%s", async kind => {
  const m = await mountTextLink(kind);
  fireEvent.click(m.link);
  await waitFor(() => expect(document.activeElement?.closest(".pane-screen")?.querySelector("[data-terminal]")?.getAttribute("data-terminal")).toBe("t-chosen"));
  expect(m.connected.rail.selected()).toBe("chosen");
  expect(m.app.calls.filter(call => call.method === "link.read").map(call => call.params)).toEqual([{ url: m.url }]);
  expect(m.app.calls.filter(call => /spawn|start|write/.test(call.method))).toEqual([]);
  m.emulators.made.get("t-chosen")!.type(new TextEncoder().encode("u5742 marker"));
  await waitFor(() => expect(m.app.calls.filter(call => call.method === "terminal.write").map(call => call.params)).toEqual([{ id: "t-chosen", data: btoa("u5742 marker") }]));
  expect(m.app.openedTargets).toEqual([]);
});

it("u5742c_refused_message_link_opens_nothing_and_exposes_its_cause", async () => {
  const m = await mountTextLink("agent");
  const selected = m.connected.rail.selected();
  m.app.handlers["link.read"] = () => { throw new RpcError(-32003, "Object access was refused"); };

  fireEvent.click(m.link);
  await screen.findByText("Object access was refused");
  expect(m.connected.rail.selected()).toBe(selected);
  expect(m.app.openedTargets).toEqual([]);
  expect(m.app.calls.filter(call => /spawn|start|write/.test(call.method))).toEqual([]);
});

it.each(["authorization", "readiness"] as const)("u5742d_message_link_preserves_newer_focus_%s", async stage => {
  const m = await mountTextLink("agent");

  if (stage === "authorization") {
    m.app.handlers["link.read"] = () => { throw new RpcError(-32003, "Previous refusal"); };

    fireEvent.click(m.link);
    await screen.findByText("Previous refusal");
  }

  let release!: () => void;

  if (stage === "authorization") m.app.handlers["link.read"] = () => new Promise(resolve => { release = () => resolve({ kind: "agent", id: "chosen", node: agent("chosen", "idle", "ready"), digest: null }); });
  else m.app.handlers["terminal.snapshot"] = () => new Promise(resolve => { release = () => resolve({ cols: 80, rows: 24, after: 0, data: "" }); });
  fireEvent.click(m.link);
  await waitFor(() => expect(release).toBeDefined());

  fireEvent.keyDown(document.activeElement ?? document.body, { key: "/", code: "Slash", metaKey: true });
  const ask = await screen.findByLabelText<HTMLTextAreaElement>("Ask", { selector: "textarea" });
  ask.focus();
  fireEvent.input(ask, { target: { value: "keep my draft" } });
  release();

  if (stage === "authorization") await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(""));
  else await waitFor(() => expect(m.emulators.made.get("t-chosen")?.host).toBeTruthy());
  expect(document.activeElement).toBe(ask);
  expect(ask.value).toBe("keep my draft");
  expect(m.app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});
