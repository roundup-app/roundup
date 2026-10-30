import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { attentionOrder } from "../rail/attention";
import { agent, event, NOW } from "../testing/nodes";
import { mountTodos, todo } from "../todos/testHarness";
import { AskBar } from "../ask/AskBar";
import { ConnectedProjectContext } from "../state/connectedProject";

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => localStorage.clear());

const act = async (run: () => void) => { await run(); await Promise.resolve(); };

const send = async (m: Awaited<ReturnType<typeof mountInbox>>, ...sent: DaemonEvent[]) => { for (const each of sent) m.app.emit(each); await m.connected.rail.settled(); await Promise.resolve(); };

const panel = () => screen.getByRole("region", { name: "Needs you" });

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
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });

  return m;
};

let revision = 1;

const status = (id: string, kind: Kind, label = "x", since = NOW) => event({ name: "agent.status", data: { status_revision: String(++revision), attempt: "1", id, status: { kind, label, since, finished: "0" } } });

const groupOf = (_name: string) => panel();

const names = (group: HTMLElement) => [...group.querySelectorAll(".inbox-row-name")].map((each) => each.textContent);

const calls = (m: Awaited<ReturnType<typeof mountInbox>>, method: string) => m.app.calls.filter((call) => call.method === method).map((call) => call.params);

it("u3770a_sections_hold_their_agents_in_order_with_counts", async () => {
  await mountInbox();
  expect(names(panel())).toEqual(["gamma", "alpha", "zeta"]);
  expect(within(panel()).getByText("3")).toBeTruthy();
  expect(within(panel()).queryByText("beta")).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Drawer" })).toBeNull();
});

it("u3770a_an_empty_inbox_says_nothing_waits", async () => {
  const m = await mountTodos([], true, [agent("i", "idle", "Idle")]);
  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  m.connected.showView("attention");
  await screen.findByText("Nothing waits for you");
  expect(panel().querySelectorAll(".inbox-group")).toHaveLength(0);
});

it("u3770b_a_row_opens_to_its_state_s_one_action", async () => {
  const m = await mountInbox();
  const head = (name: string) => within(panel()).getByText(name).closest("button")!;
  fireEvent.click(head("gamma"));
  await waitFor(() => expect(head("gamma").getAttribute("aria-expanded")).toBe("true"));
  expect(within(panel()).getByText("crashed")).toBeTruthy();
  expect(await within(panel()).findByRole("button", { name: "Retry" })).toBeTruthy();
  fireEvent.click(head("alpha"));
  expect(await within(panel()).findByText("asks")).toBeTruthy();
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
  fireEvent.click(head("alpha"));
  await expanded("alpha", "false");
  await expanded("beta", "true");
  fireEvent.click(head("alpha"));
  await expanded("beta", "false");
});

it("u3770b_escape_collapses_and_returns_focus", async () => {
  const m = await mountInbox();
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
  expect(names(panel())).not.toContain("gamma");
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
  expect(names(groupOf("Needs you"))).toContain("beta");
  expect(within(groupOf("Needs you")).getByText("4")).toBeTruthy();
  expect(within(panel()).queryByRole("region", { name: "Running" })).toBeNull();
});

it("u3770d_a_burst_ends_in_the_last_state", async () => {
  const m = await mountInbox();
  await send(m, ...(["needs-you", "working", "error", "done", "working"] as const).map((kind) => status("a", kind)));
  expect(names(panel())).not.toContain("alpha");
  expect(names(groupOf("Needs you"))).not.toContain("alpha");
  expect(within(groupOf("Needs you")).getByText("2")).toBeTruthy();
});

it("u3770d_changes_do_not_close_or_move_the_open_row", async () => {
  const m = await mountInbox();
  const head = () => within(panel()).getByText("alpha").closest("button")!;
  fireEvent.click(head());
  await send(m, status("c", "working"));
  await send(m, status("f", "done"));
  expect(head().getAttribute("aria-expanded")).toBe("true");
  expect(names(groupOf("Needs you"))).toEqual(["alpha"]);
  await send(m, status("e", "working"));
  expect(head().getAttribute("aria-expanded")).toBe("true");
});

it("u3770d_the_needs_you_count_is_a_polite_live_region", async () => {
  await mountInbox();
  expect(panel().querySelector(".inbox-count")!.getAttribute("aria-live")).toBe("polite");
});

it("u3770e_reduced_motion_makes_every_change_instant", async () => {
  const m = await mountInbox(NODES, true);
  await send(m, status("b", "needs-you"));
  expect(panel().querySelector("[data-arrived]")).toBeNull();
  await send(m, status("a", "working"));
  await waitFor(() => expect(names(groupOf("Needs you"))).not.toContain("alpha"));
});

it("u3770a_unread_comment_rows_keep_u3742_behaviour", async () => {
  const m = await mountTodos([{ ...todo(1, { title: "Ship" }) }], true, structuredClone(NODES));
  m.store.comments!.set(1, [{ id: 1, author: { kind: "agent", id: "a", parent: null }, body: "which branch?", created_at: 1, read: false }]);
  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  m.connected.showView("attention");
  const row = await within(groupOf("Needs you")).findByRole("button", { name: /alpha commented on Ship/ });
  // The unread comment row follows the Agent rows and makes no Message call.
  expect(within(row).getByText("which branch?")).toBeTruthy();
  expect(row.closest(".inbox-group")?.getAttribute("data-agent")).toBe("a");
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

  m.app.handlers["agent.resume"] = ({ id }) => { throw new Error(`resume ${id} refused`); };

  fireEvent.click(within(row("beta")).getByRole("button", { name: "Retry" }));
  await within(row("beta")).findByRole("alert");

  const label = "Retry";
  const message = "resume a refused";

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
    expect(within(panel()).queryByText("alpha")).toBeNull();
    m.app.handlers["rail.tree"] = () => nodes;
    await send(m, event({ name: "rail.changed" }));
  }

  if (head("alpha").getAttribute("aria-expanded") !== "true") fireEvent.click(head("alpha"));

  await waitFor(() => expect(within(row("alpha")).queryByRole("alert")).toBeNull());
  fireEvent.click(head("alpha"));
  expect((await within(row("beta")).findByRole("alert")).textContent).toBe("resume b refused");
  expect(m.connected.drafts.list()).toEqual(drafts);
  expect(within(panel()).getByRole("alert", { name: "cannot load comments" })).toBeTruthy();
});

it.each(["recover", "unrelated"] as const)("p3557c_failure_lifetime_inbox_%s", async (transition) => {
  const m = await mountInbox();
  m.app.handlers["todo.unread"] = () => { throw new Error("cannot load comments"); };

  await act(() => m.app.emit(event({ name: "todo.deleted", data: { id: 9 } })));
  await within(panel()).findByText("cannot load comments");

  if (transition === "recover") {
    m.app.handlers["todo.unread"] = () => [];
    fireEvent.click(within(panel()).getByRole("button", { name: "Retry Inbox" }));
    await waitFor(() => expect(within(panel()).queryByText("cannot load comments")).toBeNull());
  } else {
    m.app.handlers["rail.tree"] = () => NODES.filter((node) => node.id !== "c");
    await send(m, event({ name: "rail.changed" }));
    expect(within(panel()).getByText("cannot load comments").closest('[role="alert"]')).not.toBeNull();
  }
});
