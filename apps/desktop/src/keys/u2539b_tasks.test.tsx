import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { openProjectPage, projectMenu } from "../testing/menuProbe";
import type { ConnectedProject } from "../state/connectedProject";
import { todoHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { WORKTREE } from "../changes/harness";

// Connected App seam: acknowledged calls, selection, focus and disposal. Appearance belongs to U26.
afterEach(() => { cleanup(); localStorage.clear(); });

const key = (code: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { code, key: code === "Enter" ? "Enter" : code.replace("Key", "").toLowerCase(), bubbles: true, cancelable: true, ...options });
  (document.activeElement ?? document.body).dispatchEvent(event);
};

const leader = (code: string) => { key("KeyK", { metaKey: true }); key(code); };

const mount = async (empty = false) => {
  const app = createFakeApp();

  for (let n = 0; n < 7; n++) app.add(`/project${n}`);
  app.add("/p");
  const daemon = app.of("/p");
  const nodes = empty ? [] : [workstream("home"), ...Array.from({ length: 12 }, (_, index) => agent(`a${index}`, index === 0 ? "needs-you" : "idle", "ready", { name: `Agent ${index}`, parent: "home", worktree: WORKTREE }))];
  daemon.handlers["rail.tree"] = () => nodes;
  const shells: ReturnType<typeof info>[] = [];
  daemon.handlers["terminal.list"] = () => [...shells, ...nodes.flatMap(node => node.terminal_id ? [info(node.terminal_id, { owner: node.id })] : [])];
  daemon.handlers["agent.changedFiles"] = () => ({ files: [{ path: "a.ts", status: "modified", line: 1 }] });
  daemon.handlers["agent.worktreeState"] = () => ({ ahead: 1, behind: 0, dirty: true });
  const store = { todos: [todo(1, { title: "Selected work", home: null })] };
  Object.assign(daemon.handlers, todoHandlers(store, () => {}));
  let connected: ConnectedProject | undefined;
  const emulators = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={emulators.factory} prepareIdle={open => { connected = open; }} />);
  await screen.findByRole("textbox", { name: "Ask" });
  await waitFor(() => expect(projectMenu.path).toBe("/p"));

  return { app, daemon, connected: () => connected!, store, emulators, nodes, shells };
};

it("u2539b_landing_mounts_only_ask_and_attention", async () => {
  const { daemon } = await mount();
  expect(document.querySelector('[role="tree"], .todos-tab, .pads-tab, .terminal-tabs, .resource-value, .ask-rows, .reactions, .made-list')).toBeNull();
  expect(document.querySelectorAll(".overview-entry")).toHaveLength(1);
  expect(daemon.calls.filter(call => call.method === "agent.spawn" || call.method === "ask.send")).toHaveLength(0);
  fireEvent.click(document.querySelector<HTMLButtonElement>(".overview-entry")!);
  await waitFor(() => expect(document.querySelector(".pane-screen [data-terminal]")).not.toBeNull());
});

it("u2539b_capture_keeps_requested_work_items_unmounted_until_filing", async () => {
  await mount();
  key("KeyT", { metaKey: true, shiftKey: true });
  const field = await screen.findByRole("textbox", { name: "Capture a Todo" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(document.querySelector(".todos-tab, .shelf-tabs")).toBeNull();
});

it("u2539b_drawer_keeps_attention_reachable", async () => {
  const { connected } = await mount();
  leader("KeyS");
  const row = await screen.findByText("Selected work");
  fireEvent.click(row);
  fireEvent.keyDown(row.closest("button")!, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(connected().drawer.content()).not.toBeNull());
  const attention = document.querySelector<HTMLButtonElement>(".overview-entry");
  expect(attention).not.toBeNull();
  fireEvent.click(attention!);
  await waitFor(() => expect(connected().rail.selected()).toBe("a0"));
});

it("u2539b_selected_agent_keeps_identity_and_returns_to_landing", async () => {
  const { connected, nodes } = await mount();
  fireEvent.click(document.querySelector<HTMLButtonElement>(".overview-entry")!);
  await waitFor(() => expect(connected().rail.selected()).toBe("a0"));
  expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(nodes.find(node => node.id === "a0")!.name);
  fireEvent.click(screen.getByRole("button", { name: "Back to Ask" }));
  await waitFor(() => expect(connected().rail.selected()).toBeNull());
});

it("u2539b_other_project_attention_opens_its_requesting_terminal", async () => {
  const { app } = await mount();
  const other = app.of("/project0");
  other.handlers["rail.tree"] = () => [agent("other", "needs-you", "ready")];
  other.handlers["terminal.list"] = () => [info("t-other", { owner: "other" })];
  other.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  const attention = await screen.findByRole("button", { name: /project0.*Needs you/ });
  fireEvent.click(attention);
  await waitFor(() => expect(document.querySelector('.pane-screen [data-terminal="t-other"]')).not.toBeNull());
});

it.each(["workstreams", "ask-history", "resources", "terminal-tabs", "reactions", "made"])("u2539b_landing_opens_requested_surfaces_and_returns: %s", async view => {
  const { connected } = await mount();

  if (view === "resources") {
    expect(projectMenu.items.find(item => item.id === "view:resources")).toBeUndefined();
    connected().rail.select("a0");
    await waitFor(() => expect(projectMenu.items.find(item => item.id === "view:resources")?.enabled).toBe(true));
  }

  openProjectPage(`view:${view}`, "/p");
  await waitFor(() => expect(connected().view()).toBe(view));
  openProjectPage(`view:${view}`, "/p");
  await waitFor(() => expect(connected().view()).toBeNull());

  if (view === "resources") fireEvent.click(screen.getByRole("button", { name: "Back to Ask" }));
  expect(document.querySelector(".ask-input")).not.toBeNull();
});

it.each(["ask", "agent", "terminal", "todo", "attention", "items", "inbox", "assign", "project", "changes"].flatMap(task =>
  (task === "assign" ? ["keyboard", "native-menu"] : ["keyboard", "native-menu", "terminal"]).map(source => ({ task, source }))))("u2539b_top_ten_tasks_complete_within_three_presses: $task from $source", async ({ task, source }) => {
  const { daemon, connected, store, nodes, shells, emulators } = await mount();
  let presses = 0;
  const press = (code: string, options: KeyboardEventInit = {}) => { presses++; key(code, options); };

  const command = (id: string, code: string, options: KeyboardEventInit = {}) => {
    if (source === "native-menu") { presses++; openProjectPage(id, "/p"); }
    else press(code, options);
  };

  if (source === "terminal") {
    connected().rail.select("a1");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  }

  const runLeader = (code: string) => {
    if (source === "native-menu") { presses++; openProjectPage(`action:leader:${code.replace("Key", "")}`, "/p"); }
    else { press("KeyK", { metaKey: true }); press(code); }
  };

  if (task === "ask") {
    daemon.handlers["ask.send"] = params => ({ id: "ask", text: params.text, at: 0n, parts: [] });
    command("action:chord:⌘/", "Slash", { metaKey: true });
    fireEvent.input(await screen.findByRole("textbox", { name: "Ask" }), { target: { value: "Do this" } });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Ask" })));
    press("Enter");
    await waitFor(() => expect(daemon.calls.filter(call => call.method === "ask.send")).toHaveLength(1));
  } else if (task === "agent") {
    daemon.handlers["agent.spawn"] = () => { const node = agent("new", "idle", "ready"); nodes.push(node); daemon.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });

 return node; };

    command("action:chord:⌘N", "KeyN", { metaKey: true });
    await waitFor(() => expect(connected().rail.selected()).toBe("new"));
    expect(daemon.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1);
  } else if (task === "terminal") {
    connected().rail.select("home");
    daemon.handlers["terminal.open"] = () => { shells.push(info("shell", { owner: "home" }));

 return { terminal_id: "shell" }; };

    command("action:chord:⌘T", "KeyT", { metaKey: true });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
    expect(emulators.made.has("shell")).toBe(true);
  } else if (task === "todo") {
    command("action:chord:⇧⌘T", "KeyT", { metaKey: true, shiftKey: true });
    const field = await screen.findByRole("textbox", { name: "Capture a Todo" });
    fireEvent.input(field, { target: { value: "Capture me" } });
    press("Enter");
    await waitFor(() => expect(store.todos.some(row => row.title === "Capture me")).toBe(true));
  } else if (task === "attention") {
    runLeader("KeyJ");
    await waitFor(() => expect(connected().rail.selected()).toBe("a0"));
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a0"));
  } else if (task === "items") {
    runLeader("KeyS");
    await screen.findByRole("region", { name: "Todos" });
    expect(document.querySelector(".todos-tab")).not.toBeNull();
  } else if (task === "inbox") {
    runLeader("KeyI");
    await screen.findByRole("region", { name: "Inbox" });
    expect(document.querySelector(".inbox")).not.toBeNull();
  } else if (task === "assign") {
    leader("KeyS");
    fireEvent.click(await screen.findByRole("button", { name: /Unassigned/ }));
    const row = await screen.findByRole("button", { name: /Selected work/ });
    fireEvent.click(row);
    screen.getByRole("textbox", { name: "Ask" }).focus();
    runLeader("KeyA");
    const field = await screen.findByRole("combobox");
    fireEvent.input(field, { target: { value: "Agent 11" } });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await waitFor(() => expect(field.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Agent 11" }).id));
    press("Enter");
    await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.assign").map(call => call.params)).toEqual([{ id: 1, owner: { kind: "agent", id: "a11", parent: null } }]));
  } else if (task === "project") {
    connected().rail.select("a1");
    runLeader("KeyP");
    const field = await screen.findByRole("combobox");
    fireEvent.input(field, { target: { value: "project6" } });
    await waitFor(() => expect(document.activeElement).toBe(field));
    press("Enter");
    await waitFor(() => expect(projectMenu.path).toBe("/project6"));
  } else {
    connected().rail.select("a1");
    await screen.findByRole("button", { name: /\d+ changed files?/ });
    runLeader("KeyC");
    await screen.findByRole("dialog", { name: "Worktree" });
    await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  }

  expect(presses).toBeLessThanOrEqual(3);
});

it("u2539b_native_menu_projects_the_task_chords", async () => {
  const { daemon, connected } = await mount();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:leader:J")?.enabled).toBe(true));
  expect(projectMenu.items.filter(item => item.id.startsWith("action:")).map(item => [item.id, item.shortcut])).toEqual([
    ["action:chord:⌘N", "⌘N"], ["action:chord:⌘T", "⌘T"], ["action:chord:⇧⌘T", "⇧⌘T"], ["action:chord:⌘/", "⌘/"],
    ["action:leader:A", "⌘K A"], ["action:leader:P", "⌘K P"], ["action:leader:C", "⌘K C"], ["action:leader:J", "⌘K J"],
    ["action:leader:S", "⌘K S"], ["action:leader:I", "⌘K I"],
  ]);
  openProjectPage("action:leader:J", "/wrong-project");
  expect(connected().rail.selected()).toBeNull();
  openProjectPage("action:leader:J", "/p");
  await waitFor(() => expect(connected().rail.selected()).toBe("a0"));
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(0);
});

it("u2539b_empty_project_can_submit_an_ask", async () => {
  const { daemon } = await mount(true);
  daemon.handlers["ask.send"] = params => ({ id: "first", text: params.text, at: 0n, parts: [] });
  const field = screen.getByRole("textbox", { name: "Ask" });
  expect(daemon.calls.filter(call => call.method === "agent.spawn" || call.method === "ask.send")).toHaveLength(0);
  field.focus();
  fireEvent.input(field, { target: { value: "First work" } });
  key("Enter");
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "ask.send").map(call => call.params)).toEqual([expect.objectContaining({ text: "First work" })]));
});

it("u2539b_strip_items_follow_actionable_facts", async () => {
  const { connected, emulators, daemon } = await mount();
  connected().rail.select("a1");
  await screen.findByRole("button", { name: /\d+ changed files?/ });
  await waitFor(() => expect(emulators.made.has("t-a1")).toBe(true));
  const terminal = emulators.made.get("t-a1");
  const portal = document.querySelector(".resource-agent");
  expect(document.querySelector(".resource-strip .resource-value, .resource-strip .terminal-tabs, .hint-line")).toBeNull();
  openProjectPage("view:resources", "/p");
  await screen.findByRole("region", { name: "Resources" });
  openProjectPage("view:resources", "/p");
  openProjectPage("view:terminal-tabs", "/p");
  await screen.findByRole("group", { name: "Terminals" });
  openProjectPage("view:terminal-tabs", "/p");
  expect(document.querySelector(".resource-agent")).toBe(portal);
  expect(emulators.made.get("t-a1")).toBe(terminal);
  expect(terminal?.disposed).toBe(false);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(0);
});

it("u2539b_hiding_optional_views_preserves_original_drafts", async () => {
  const { connected, daemon } = await mount();
  const text = "  unfinished\nexact work 🐈  ";
  fireEvent.input(screen.getByRole("textbox", { name: "Ask" }), { target: { value: text } });
  const original = connected().drafts.list().find(draft => draft.destination.surface === "ask")!;
  openProjectPage("view:ask-history", "/p");
  openProjectPage("view:ask-history", "/p");
  connected().rail.select("a1");
  connected().rail.select(null);
  const restored = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
  expect(restored.value).toBe(text);
  expect(connected().drafts.list().find(draft => draft.revision === original.revision)?.destination).toEqual(original.destination);
  expect(daemon.calls.filter(call => call.method === "ask.send")).toHaveLength(0);
});

it("u2539b_unknown_and_late_answers_never_supply_another_selection", async () => {
  const { connected, daemon } = await mount();
  let finish!: (value: { files: [] }) => void;
  daemon.handlers["agent.changedFiles"] = ({ id }) => id === "a1" ? new Promise(resolve => { finish = resolve; }) : { files: [{ path: "current", status: "modified", line: 1 }] };
  connected().rail.select("a1");
  await waitFor(() => expect(daemon.calls.some(call => call.method === "agent.changedFiles")).toBe(true));
  expect(document.querySelector(".worktree-control")).toBeNull();
  connected().rail.select("a2");
  await screen.findByRole("button", { name: /\d+ changed files?/ });
  finish({ files: [] });
  await waitFor(() => expect(Number(document.querySelector(".worktree-control")?.textContent)).toBe(1));
});

it("u2539b_last_change_removed_closes_to_a_surviving_target", async () => {
  const { connected, daemon, emulators } = await mount();
  connected().rail.select("a1");
  fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
  await screen.findByRole("dialog", { name: "Worktree" });
  const original = emulators.made.get("t-a1");
  daemon.handlers["agent.changedFiles"] = () => ({ files: [] });
  await connected().worktrees.refresh("a1");
  await waitFor(() => expect(document.querySelector(".worktree-control, .worktree-panel")).toBeNull());
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  expect(emulators.made.get("t-a1")).toBe(original);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(0);
});

it.each(["working", "idle", "blocked", "needs-you", "error", "done"] as const)("u2539b_each_status_has_at_most_three_resting_presentations: %s", async kind => {
  const { connected, daemon, nodes } = await mount();
  const target = nodes.find(node => node.id === "a0")!;
  daemon.emit({ actor: { kind: "user", id: "you", parent: null }, name: "agent.status", data: { id: target.id, attempt: "1", status_revision: "2", status: { kind, label: "current fact", since: 1, finished: "0" } } });
  const attention = kind === "needs-you" || kind === "error";

  const places = () => {
    const found: string[] = [];

    // Each owner counts once: its label and glyph are one presentation. Aggregates
    // are separate owners and count even when they display only a number.
    if (document.querySelector('.rail-row[data-id="a0"]')) found.push("Agent row");

    if (connected().rail.collapsed().has("home") && document.querySelector('.rail-row[data-id="home"]')) found.push("collapsed ancestor");

    if (attention && document.querySelector(".todo-project-root .ink-count")) found.push("Project root aggregate");

    if (attention && document.querySelector(".overview-heading")) found.push("Needs you heading");

    if ([...document.querySelectorAll(".overview-entry")].some(row => row.textContent?.includes(target.name))) found.push("Needs you entry");

    if ([...document.querySelectorAll(".inbox-item")].some(row => row.textContent?.includes(target.name))) {
      found.push("Inbox entry", "Inbox section count");
    }

    if (connected().rail.selected() === target.id && document.querySelector(".pane-identity [data-state]")) found.push("Selected Agent title");

    return found;
  };

  await waitFor(() => expect(connected().rail.nodes.find(node => node.id === target.id)?.status?.kind).toBe(kind));
  expect(places().length).toBeLessThanOrEqual(3);
  openProjectPage("view:workstreams", "/p");
  await waitFor(() => expect(document.querySelector(".rail-tree")).not.toBeNull());
  expect(places().length).toBeLessThanOrEqual(3);
  connected().rail.toggleCollapsed("home");
  expect(places().length).toBeLessThanOrEqual(3);
  connected().rail.select("a0");
  expect(places().length).toBeLessThanOrEqual(3);
  leader("KeyI");
  await screen.findByRole("region", { name: "Inbox" });
  expect(places().length).toBeLessThanOrEqual(3);
});


it("u4278a_unavailable_actions_are_hidden_or_explain_on_use", async () => {
  const { daemon } = await mount(true);
  await waitFor(() => expect(projectMenu.items.some(item => ["action:leader:C", "action:leader:A", "action:leader:J", "view:resources"].includes(item.id))).toBe(false));
  expect(projectMenu.items.every(item => item.enabled)).toBe(true);
  openProjectPage("action:leader:C", "/p");
  openProjectPage("action:leader:A", "/p");
  openProjectPage("action:leader:J", "/p");
  expect(daemon.calls.filter(call => ["agent.changedFiles", "todo.assign", "terminal.write"].includes(call.method))).toHaveLength(0);
});
