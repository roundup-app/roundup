import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent, event, NOW } from "../testing/nodes";
import { mountTodos, todo } from "../todos/testHarness";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";
import { info } from "../testing/nodes";
import { AskBar } from "../ask/AskBar";
import { ConnectedProjectContext } from "../state/connectedProject";

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => localStorage.clear());

const act = async (run: () => void) => { await run(); await Promise.resolve(); };

const send = async (m: Awaited<ReturnType<typeof mountInbox>>, ...sent: DaemonEvent[]) => { for (const each of sent) m.app.emit(each); await m.connected.rail.settled(); await Promise.resolve(); };

const panel = () => document.querySelector<HTMLElement>(".inbox")!;

const NODES: RailNode[] = [
  agent("a", "needs-you", "asks", { name: "alpha", order: 0 }),
  agent("b", "working", "editing Thread.tsx", { name: "beta", order: 1 }),
  agent("c", "error", "crashed", { name: "gamma", order: 2 }),
  agent("d", "done", "finished", { name: "delta", order: 3, status: { kind: "done", label: "finished", since: NOW - 10, finished: "0" } }),
  agent("e", "done", "finished", { name: "epsilon", order: 4, status: { kind: "done", label: "finished", since: NOW, finished: "0" } }),
  agent("f", "needs-you", "asks", { name: "zeta", order: 5, status: { kind: "needs-you", label: "asks", since: NOW + 1, finished: "0" } }),
];

const mountInbox = async (nodes: RailNode[] = NODES, reducedMotion = true) => {
  const m = await mountTodos([], reducedMotion, structuredClone(nodes));
  m.app.handlers["agent.resume"] = () => ({ ...NODES[2]! });
  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  m.connected.showView(null);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });

  return m;
};

let revision = 1;

const status = (id: string, kind: Kind, label = "x", since = NOW) => event({ name: "agent.status", data: { status_revision: String(++revision), attempt: "1", id, status: { kind, label, since, finished: "0" } } });

const groupOf = (_name: string) => panel();

const names = (group: HTMLElement) => [...group.querySelectorAll("[data-row]")].map(each => each.getAttribute("data-row")!.slice(2));

const calls = (m: Awaited<ReturnType<typeof mountInbox>>, method: string) => m.app.calls.filter((call) => call.method === method).map((call) => call.params);

it("u3770a_sections_hold_their_agents_in_order_with_counts", async () => {
  await mountInbox();
  expect(names(panel())).toEqual(["c", "a", "f"]);
  expect(Number(document.querySelector(".inbox-count")!.textContent)).toBe(3);
  expect(panel().querySelector('[data-row="a:b"]')).toBeNull();

});

it("u3770a_an_empty_inbox_says_nothing_waits", async () => {
  const m = await mountTodos([], true, [agent("i", "idle", "Idle")]);
  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  m.connected.showView(null);
  m.connected.showView("attention");
  await screen.findByText("Nothing needs you");
  expect(panel().querySelectorAll(".inbox-group")).toHaveLength(0);
});

it("u3770b_a_row_opens_to_its_state_s_one_action", async () => {
  const m = await mountInbox();
  const head = (name: string) => within(panel()).getByText(name).closest("button")!;
  fireEvent.click(head("gamma"));
  await waitFor(() => expect(head("gamma").getAttribute("aria-expanded")).toBe("true"));
  await within(panel()).findAllByText(NODES[2]!.status!.label);
  await within(panel()).findByRole("button", { name: "Retry" });
  fireEvent.click(head("alpha"));
  await within(panel()).findByText(NODES[0]!.status!.label);
  fireEvent.click(within(head("alpha").closest("li")!).getByRole("button", { name: "Open" }));
  expect(m.connected.rail.selected()).toBe("a");
  expect(m.connected.drawer.content()).toBeNull();
});

it("u3770b_one_row_is_open_at_a_time", async () => {
  await mountInbox();
  const head = (name: string) => within(panel()).getByText(name).closest("button")!;
  const expanded = (name: string, value: string) => waitFor(() => expect(head(name).getAttribute("aria-expanded")).toBe(value));
  fireEvent.click(head("alpha"));
  await expanded("alpha", "true");
  fireEvent.click(head("gamma"));
  await expanded("alpha", "false");
  await expanded("gamma", "true");
  fireEvent.click(head("gamma"));
  await expanded("gamma", "false");
});

it("u3770b_escape_collapses_and_returns_focus", async () => {
  await mountInbox();
  const head = within(panel()).getByText("gamma").closest("button")!;
  fireEvent.click(head);
  (await within(panel()).findByRole("button", { name: "Retry" })).focus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(head.getAttribute("aria-expanded")).toBe("false"));
  expect(document.activeElement).toBe(head);
  expect(screen.getByRole("button", { name: /^Needs you/ }).getAttribute("aria-expanded")).toBe("true");
});

it("u3770c_retry_resumes_the_failed_agent", async () => {
  const m = await mountInbox();
  fireEvent.click(within(panel()).getByText("gamma").closest("button")!);
  fireEvent.click(await within(panel()).findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(calls(m, "agent.resume")).toEqual([{ id: "c" }]));
  await send(m, status("c", "working"));
  expect(names(panel())).not.toContain("c");
});

it("u3770c_a_failed_call_keeps_the_row_open_with_the_error", async () => {
  const m = await mountInbox();
  m.app.handlers["agent.resume"] = () => { throw new Error("cannot resume"); };

  fireEvent.click(within(panel()).getByText("gamma").closest("button")!);
  fireEvent.click(await within(panel()).findByRole("button", { name: "Retry" }));
  await within(panel()).findByRole("alert");

  expect(within(panel()).getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(false);
  expect(within(panel()).getByText("gamma").closest("button")!.getAttribute("aria-expanded")).toBe("true");
});

it("u3770d_a_status_event_moves_the_row_and_counts", async () => {
  const m = await mountInbox();
  await send(m, status("b", "needs-you"));
  expect(names(groupOf("Needs you"))).toContain("b");
  expect(Number(document.querySelector(".inbox-count")!.textContent)).toBe(4);
});

it("u3770d_a_burst_ends_in_the_last_state", async () => {
  const m = await mountInbox();
  await send(m, ...(["needs-you", "working", "error", "done", "working"] as const).map((kind) => status("a", kind)));
  expect(names(panel())).not.toContain("a");
  expect(Number(document.querySelector(".inbox-count")!.textContent)).toBe(2);
});

it("u3770d_changes_do_not_close_or_move_the_open_row", async () => {
  const m = await mountInbox();
  const head = () => within(panel()).getByText("alpha").closest("button")!;
  fireEvent.click(head());
  await send(m, status("c", "working"));
  await send(m, status("f", "done"));
  expect(head().getAttribute("aria-expanded")).toBe("true");
  expect(names(groupOf("Needs you"))).toEqual(["a"]);
  await send(m, status("e", "working"));
  expect(head().getAttribute("aria-expanded")).toBe("true");
});

it("u3770d_the_needs_you_count_is_a_polite_live_region", async () => {
  await mountInbox();
  expect(document.querySelector(".inbox-count")!.getAttribute("aria-live")).toBe("polite");
});

it("u3770e_reduced_motion_makes_every_change_instant", async () => {
  const m = await mountInbox(NODES, true);
  await send(m, status("b", "needs-you"));
  expect(panel().querySelector("[data-arrived]")).toBeNull();
  await send(m, status("a", "working"));
  await waitFor(() => expect(names(groupOf("Needs you"))).not.toContain("a"));
});

it("u3770a_unread_comment_rows_keep_u3742_behaviour", async () => {
  const m = await mountTodos([{ ...todo(1, { title: "Ship" }) }], true, structuredClone(NODES));
  m.store.comments!.set(1, [{ id: 1, author: { kind: "agent", id: "a", parent: null }, body: "which branch?", created_at: 1, read: false }, { id: 2, author: { kind: "agent", id: "c", parent: null }, body: "error details", created_at: 2, read: false }, { id: 3, author: { kind: "agent", id: "a", parent: null }, body: "second question", created_at: 3, read: false }]);
  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  m.connected.showView(null);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });
  const row = (await within(groupOf("Needs you")).findAllByRole("button", { name: /alpha.*Ship/ }))[0]!;
  // The unread comment row follows the Agent rows and makes no Message call.
  expect(within(row).getByText(m.store.comments!.get(1)![0]!.body)).toBeTruthy();
  expect(row.closest(".inbox-group")?.getAttribute("data-agent")).toBe("a");
  expect([...panel().querySelectorAll(".inbox-group")].map(group => [group.getAttribute("data-agent"), [...group.querySelectorAll("[data-comment]")].map(row => row.getAttribute("data-comment"))])).toEqual([["c", ["2"]], ["a", ["1", "3"]], ["f", []]]);
  expect(m.app.calls.some((call) => call.method.startsWith("message."))).toBe(false);
});

it.each(["dismiss", "acknowledge", "remove"] as const)("p3557c_failure_lifetime_inboxrow_resume_%s", async (transition) => {
  const nodes = [agent("a", "error", "crashed", { name: "alpha" }), agent("b", "error", "crashed", { name: "beta" })];
  const m = await mountInbox(nodes);

  fireEvent.click(screen.getByRole("button", { name: /^add todo to/ }));
  const input = await screen.findByRole("textbox", { name: "New Todo title" });

  fireEvent.input(input, { target: { value: "  unfinished e\u0301 東京 🧭  " } });
  const drafts = structuredClone(m.connected.drafts.list());

  expect(drafts.map((draft) => draft.value.title)).toContain("  unfinished e\u0301 東京 🧭  ");
  const row = (name: string) => within(panel()).getByText(name).closest("li")!;
  const head = (name: string) => within(row(name)).getByText(name).closest("button")!;

  m.app.handlers["todo.unread"] = () => { throw new Error("cannot load comments"); };

  await act(() => m.app.emit(event({ name: "todo.deleted", data: { id: 9 } })));
  await within(panel()).findByText("cannot load comments");

  const refused = new Map(nodes.map(node => [node.id, new Error(`resume ${node.id} refused`)]));
  m.app.handlers["agent.resume"] = ({ id }) => { throw refused.get(id); };

  fireEvent.click(within(row("beta")).getByRole("button", { name: "Retry" }));
  await within(row("beta")).findByRole("alert");

  const label = "Retry";
  const message = refused.get("a")!.message;

  fireEvent.click(within(row("alpha")).getByRole("button", { name: label }));
  expect((await within(row("alpha")).findByRole("alert")).textContent).toBe(message);

  if (transition === "dismiss") {
    const dismiss = within(row("alpha")).getByRole("button", { name: "Dismiss" });

    dismiss.focus();
    fireEvent.click(dismiss);
    expect(document.activeElement).toBe(head("alpha"));
  }

  if (transition === "acknowledge") {
    let acknowledge!: () => void;
    const reply = new Promise<void>((resolve) => { acknowledge = resolve; });

    m.app.handlers["agent.resume"] = async () => { await reply;

 return nodes[0]!; };


    fireEvent.click(within(row("alpha")).getByRole("button", { name: label }));
    expect(within(row("alpha")).getByRole("alert").textContent).toBe(message);
    acknowledge();
    await waitFor(() => expect(within(panel()).queryByText(message)).toBeNull());
  }

  if (transition === "remove") {
    m.app.handlers["rail.tree"] = () => [nodes[1]!];
    await send(m, event({ name: "rail.changed" }));
    expect(panel().querySelector('[data-row="a:a"]')).toBeNull();
    m.app.handlers["rail.tree"] = () => nodes;
    await send(m, event({ name: "rail.changed" }));
  }

  if (head("alpha").getAttribute("aria-expanded") !== "true") fireEvent.click(head("alpha"));

  await waitFor(() => expect(within(row("alpha")).queryByRole("alert")).toBeNull());
  fireEvent.click(head("alpha"));
  expect((await within(row("beta")).findByRole("alert")).textContent).toBe(refused.get("b")!.message);
  expect(m.connected.drafts.list()).toEqual(drafts);
  expect(within(panel()).getAllByRole("alert")).toHaveLength(2);
});

it.each(["recover", "unrelated"] as const)("p3557c_failure_lifetime_inbox_%s", async (transition) => {
  const m = await mountInbox();
  m.app.handlers["todo.unread"] = () => { throw new Error("cannot load comments"); };

  await act(() => m.app.emit(event({ name: "todo.deleted", data: { id: 9 } })));
  await within(panel()).findByText("cannot load comments");

  if (transition === "recover") {
    m.app.handlers["todo.unread"] = () => [];
    fireEvent.click(within(panel()).getByRole("button", { name: "Retry Inbox" }));
    await waitFor(() => expect(within(panel()).queryByRole("alert")).toBeNull());
  } else {
    m.app.handlers["rail.tree"] = () => NODES.filter((node) => node.id !== "c");
    await send(m, event({ name: "rail.changed" }));
    expect(within(panel()).getByRole("alert")).not.toBeNull();
  }
});

it("u3770a_comment_only_attention_opens_needs_you_without_marking_read", async () => {
  const m = await mountTodos([todo(1, { title: "Review" })], true, [agent("a", "working", "editing", { name: "alpha" })]);
  m.store.comments!.set(1, [{ id: 7, author: { kind: "agent", id: "a", parent: null }, body: "review this", created_at: 10, read: false }]);
  m.connected.showView(null);
  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  const row = await screen.findByRole("button", { name: /alpha.*Review/ });
  expect(row.closest(".inbox-group")?.getAttribute("data-agent")).toBe("a");
  expect(screen.getByRole("button", { name: /^Needs you/ }).getAttribute("aria-expanded")).toBe("true");
  expect(calls(m, "todo.markCommentsRead")).toEqual([]);
  expect(panel().querySelector('[data-row="a:a"]')).toBeNull();
});


it.each(["rail", "ask", "bench", "drawer", "agent-terminal", "shell-terminal", "empty-key", "empty-menu", "idle-key", "idle-menu", "menu"])("u3770e_inbox_route_opens_overview_needs_you_once: %s", async from => {
  const { connected, daemon, shells } = await mountNavigation(from.startsWith("empty"), 0);

  if (from.startsWith("idle")) {
    daemon.handlers["rail.tree"] = () => [agent("idle", "idle", "ready")];
    await connected().rail.refresh();
  }

  const ask = screen.getByRole("textbox", { name: "Ask" });
  const draft = "  exact é 東京 🧭 draft  ";
  fireEvent.input(ask, { target: { value: draft } });
  await screen.findByRole("button", { name: "Made" });
  connected().showView("made");
  await waitFor(() => expect(screen.getByRole("button", { name: "Made" }).getAttribute("aria-expanded")).toBe("true"));

  expect(screen.getByRole("button", { name: /^Needs you/ }).getAttribute("aria-expanded")).toBe("false");

  if (from.startsWith("idle")) connected().rail.select("idle");

  if (from === "bench") connected().showView("shelf");

  if (from === "drawer") connected().drawer.open(() => <button type="button">Drawer action</button>);

  if (from === "rail" || from === "agent-terminal") connected().rail.select("a0");

  if (from === "shell-terminal") {
    daemon.handlers["terminal.open"] = () => { shells.push(info("shell", { owner: "home" }));

 return { terminal_id: "shell" }; };

    await connected().rail.refresh({ terminals: true });
    connected().rail.select("home");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "t", code: "KeyT", metaKey: true });
  }

  if (from === "ask") ask.focus();

  if (from.endsWith("terminal")) await waitFor(() => expect(document.activeElement?.hasAttribute("data-terminal")).toBe(true));
  const before = daemon.calls.length;

  const route = () => {
    if (from === "menu" || from.endsWith("-menu")) openProjectPage("action:leader:I", "/p");
    else {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "k", code: "KeyK", metaKey: true });
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "i", code: "KeyI" });
    }
  };

  for (let invocation = 0; invocation < 2; invocation++) {
    route();
    const heading = screen.getByRole("button", { name: /^Needs you/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(connected().rail.selected()).toBeNull();
    expect(connected().drawer.content()).toBeNull();
    expect(["Needs you", "Asks", "Reactions", "Made"].map(name => screen.getByRole("button", { name }).getAttribute("aria-expanded"))).toEqual(["true", "false", "false", "false"]);

    if (from.startsWith("empty") || from.startsWith("idle")) {
      const inbox = screen.getByRole("region", { name: "Needs you" });
      expect(within(inbox).queryAllByRole("listitem")).toHaveLength(0);
      expect(inbox.textContent?.trim()).not.toBe("");
    }

    expect(connected().project.path).toBe("/p");
    expect(projectMenu.path).toBe("/p");
    expect(screen.getByRole("textbox", { name: "Ask" })).toHaveProperty("value", draft);
    expect(daemon.calls.slice(before).filter(call => ["terminal.write", "ask.send", "agent.resume", "rail.startDoor", "agent.spawn"].includes(call.method))).toEqual([]);
  }
});
