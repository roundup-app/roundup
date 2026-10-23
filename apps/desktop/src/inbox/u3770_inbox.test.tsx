import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { asking, cleared, decision, opened } from "../decisions/decisionsFixture";
import { agent, event, NOW } from "../testing/nodes";
import { mountTodos, todo } from "../todos/testHarness";
import { Inbox } from "./Inbox";

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => localStorage.clear());

const act = async (run: () => void) => { await run(); await Promise.resolve(); };

const send = async (m: Awaited<ReturnType<typeof mountInbox>>, ...sent: DaemonEvent[]) => { for (const each of sent) m.app.emit(each); await m.connected.rail.settled(); await Promise.resolve(); };

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const NODES: RailNode[] = [
  agent("a", "needs-you", "asks", { name: "alpha", order: 0 }),
  agent("b", "working", "editing Thread.tsx", { name: "beta", order: 1 }),
  agent("c", "error", "crashed", { name: "gamma", order: 2 }),
  agent("d", "done", "finished", { name: "delta", order: 3, status: { kind: "done", label: "finished", since: NOW - 10 } }),
  agent("e", "done", "finished", { name: "epsilon", order: 4, status: { kind: "done", label: "finished", since: NOW } }),
  agent("f", "needs-you", "asks", { name: "zeta", order: 5, status: { kind: "needs-you", label: "asks", since: NOW + 1 } }),
];

const mountInbox = async (nodes: RailNode[] = NODES, reducedMotion = true) => {
  const m = await mountTodos([], reducedMotion, structuredClone(nodes));
  m.app.handlers["decision.list"] = () => [];
  m.app.handlers["decision.capture"] = ({ id }) => ({ daemon: "d", agent: "a", attempt: "1", decision: id });
  m.app.handlers["decision.answer"] = () => null;
  m.app.handlers["agent.resume"] = () => ({ ...NODES[2]! });
  m.connected.drawer.open(() => <Inbox />);
  await within(panel()).findByRole("heading", { name: "Needs you" });

  return m;
};

let revision = 1;

const status = (id: string, kind: Kind, label = "x", since = NOW) => event({ name: "agent.status", data: { status_revision: String(++revision), attempt: "1", id, status: { kind, label, since } } });

const groupOf = (name: string) => within(panel()).getByRole("region", { name });

const names = (group: HTMLElement) => [...group.querySelectorAll(".inbox-row-name")].map((each) => each.textContent);

const calls = (m: Awaited<ReturnType<typeof mountInbox>>, method: string) => m.app.calls.filter((call) => call.method === method).map((call) => call.params);

const open = (m: Awaited<ReturnType<typeof mountInbox>>, decisionRow: ReturnType<typeof decision>) => act(() => m.app.emit(opened(decisionRow)));

it("u3770a_sections_hold_their_agents_in_order_with_counts", async () => {
  await mountInbox();
  const sections = within(panel()).getAllByRole("region").filter((each) => each.getAttribute("aria-label") !== "Inbox").map((each) => each.getAttribute("aria-label"));
  expect(sections).toEqual(["Needs you", "Running", "Done"]);
  expect(names(groupOf("Needs you"))).toEqual(["gamma", "alpha", "zeta"]);
  expect(names(groupOf("Running"))).toEqual(["beta"]);
  expect(names(groupOf("Done"))).toEqual(["epsilon", "delta"]);
  expect(within(groupOf("Needs you")).getByText("3")).toBeTruthy();
  expect(within(groupOf("Done")).getByText("2")).toBeTruthy();
  expect(within(groupOf("Running")).getAllByRole("img", { name: "Working" })).toHaveLength(1);
});

it("u3770a_an_empty_inbox_says_nothing_waits", async () => {
  const m = await mountTodos([], true, [agent("i", "idle", "Idle")]);
  m.connected.drawer.open(() => <Inbox />);
  await within(panel()).findByText("Nothing waits for you");
  expect(within(panel()).queryByRole("region", { name: "Needs you" })).toBeNull();
});

it("u3770b_a_decision_row_shows_its_two_quick_answers", async () => {
  const m = await mountInbox();
  await open(m, decision("d1", "a"));
  await open(m, asking("d2", "f", "which branch?", ["main", "dev", "other"]));
  await open(m, asking("d3", "c", "free text only", []));
  const alpha = within(panel()).getByText("alpha").closest("li")!;
  expect(within(alpha).getByRole("button", { name: "Approve" })).toBeTruthy();
  expect(within(alpha).getByRole("button", { name: "Reject" })).toBeTruthy();
  const zeta = within(panel()).getByText("zeta").closest("li")!;
  expect(within(zeta).getAllByRole("button").map((each) => each.textContent)).toEqual(["zetawhich branch?", "main", "dev"]);
  const gamma = within(panel()).getByText("gamma").closest("li")!;
  expect(within(gamma).getByRole("button", { name: "Open card" })).toBeTruthy();
});

it("u3770b_a_row_opens_to_its_state_s_one_action", async () => {
  const m = await mountInbox();
  const head = (name: string) => within(panel()).getByText(name).closest("button")!;
  fireEvent.click(head("gamma"));
  await waitFor(() => expect(head("gamma").getAttribute("aria-expanded")).toBe("true"));
  expect(within(panel()).getByText("crashed")).toBeTruthy();
  expect(await within(panel()).findByRole("button", { name: "Retry" })).toBeTruthy();
  fireEvent.click(head("beta"));
  expect(await within(panel()).findByText("editing Thread.tsx")).toBeTruthy();
  fireEvent.click(within(head("beta").closest("li")!).getByRole("button", { name: "Open" }));
  expect(m.connected.rail.selected()).toBe("b");
  expect(m.connected.drawer.content()).toBeNull();
});

it("u3770b_one_row_is_open_at_a_time", async () => {
  await mountInbox();
  const head = (name: string) => within(panel()).getByText(name).closest("button")!;
  const expanded = (name: string, value: string) => waitFor(() => expect(head(name).getAttribute("aria-expanded")).toBe(value));
  fireEvent.click(head("alpha"));
  await expanded("alpha", "true");
  fireEvent.click(head("beta"));
  await expanded("alpha", "false");
  await expanded("beta", "true");
  fireEvent.click(head("beta"));
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
  expect(m.connected.drawer.content()).not.toBeNull();
});

it("u3770c_approve_and_reject_answer_through_decision_answer", async () => {
  const m = await mountInbox();
  await open(m, decision("d1", "a"));
  await open(m, decision("d2", "f"));
  const row = (name: string) => within(panel()).getByText(name).closest("li")!;
  fireEvent.click(await within(row("alpha")).findByRole("button", { name: "Approve" }));
  await waitFor(() => expect(calls(m, "decision.answer")).toHaveLength(1));
  expect(calls(m, "decision.answer")[0]).toMatchObject({ id: "d1", answer: "allow", identity: { decision: "d1" } });
  fireEvent.click(await within(row("zeta")).findByRole("button", { name: "Reject" }));
  await waitFor(() => expect(calls(m, "decision.answer")).toHaveLength(2));
  expect(calls(m, "decision.answer")[1]).toMatchObject({ id: "d2", answer: "deny" });
});

it("u3770c_retry_resumes_the_failed_agent", async () => {
  const m = await mountInbox();
  fireEvent.click(within(panel()).getByText("gamma").closest("button")!);
  fireEvent.click(await within(panel()).findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(calls(m, "agent.resume")).toEqual([{ id: "c" }]));
  await send(m, status("c", "working"));
  expect(names(groupOf("Running"))).toEqual(["beta", "gamma"]);
});

it("u3770c_a_failed_call_keeps_the_row_open_with_the_error", async () => {
  const m = await mountInbox();
  m.app.handlers["agent.resume"] = () => { throw new Error("cannot resume"); };

  fireEvent.click(within(panel()).getByText("gamma").closest("button")!);
  fireEvent.click(await within(panel()).findByRole("button", { name: "Retry" }));
  await within(panel()).findByRole("alert");

  expect(within(panel()).getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(false);
  expect(within(panel()).getByText("gamma").closest("button")!.getAttribute("aria-expanded")).toBe("true");

  await open(m, decision("d1", "a"));


  m.app.handlers["decision.answer"] = () => { throw new Error("the original prompt is gone"); };

  fireEvent.click(within(within(panel()).getByText("alpha").closest("li")!).getByRole("button", { name: "Approve" }));
  await within(panel()).findByText(/Answer in the Terminal/);
  expect(within(panel()).getByText("alpha").closest("button")!.getAttribute("aria-expanded")).toBe("true");
});

it("u3770c_an_answer_confirms_then_folds_and_opens_the_next_decision", async () => {
  const m = await mountInbox(NODES, false);
  await open(m, decision("d1", "a"));
  await open(m, { ...decision("d2", "f"), opened_at: 2 });
  const row = (name: string) => within(panel()).getByText(name).closest("li")!;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(within(row("alpha")).getByRole("button", { name: "Approve" }));
  const confirmation = await within(panel()).findByRole("status");
  expect(confirmation.textContent).toBe("Approved");
  // The Daemon moves the answered Agent on; until then its row would show again for its Kind.
  await send(m, status("a", "working"));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(panel().querySelector("li[data-phase='fold']")!.hasAttribute("inert")).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(names(groupOf("Needs you"))).not.toContain("alpha");
  expect(within(panel()).getByText("zeta").closest("button")!.getAttribute("aria-expanded")).toBe("true");
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
  expect(names(groupOf("Running"))).toContain("alpha");
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
  const live = (name: string) => groupOf(name).querySelector(".inbox-count")!.getAttribute("aria-live");
  expect(live("Needs you")).toBe("polite");
  expect(live("Running")).toBeNull();
  expect(live("Done")).toBeNull();
});

it("u3770e_reduced_motion_makes_every_change_instant", async () => {
  const m = await mountInbox(NODES, true);
  await open(m, decision("d1", "a"));
  await send(m, status("b", "needs-you"));
  expect(panel().querySelector("[data-arrived]")).toBeNull();
  fireEvent.click(within(panel()).getByRole("button", { name: "Approve" }));
  await send(m, status("a", "working"));
  await waitFor(() => expect(names(groupOf("Needs you"))).not.toContain("alpha"));
  expect(within(panel()).queryByRole("status")).toBeNull();
});

it("u3770a_unread_comment_rows_keep_u3742_behaviour", async () => {
  const m = await mountTodos([{ ...todo(1, { title: "Ship" }) }], true, structuredClone(NODES));
  m.app.handlers["decision.list"] = () => [];
  m.store.comments!.set(1, [{ id: 1, author: { kind: "agent", id: "a", parent: null }, body: "which branch?", created_at: 1, read: false }]);
  m.connected.drawer.open(() => <Inbox />);
  const row = await within(groupOf("Needs you")).findByRole("button", { name: /alpha commented on Ship/ });
  // The unread comment row follows the Agent rows and makes no Message call.
  expect(within(row).getByText("which branch?")).toBeTruthy();
  expect(groupOf("Needs you").lastElementChild!.contains(row)).toBe(true);
  expect(m.app.calls.some((call) => call.method.startsWith("message."))).toBe(false);
});

it("u3770c_answering_the_last_decision_keeps_focus_on_a_row_that_stays_mounted", async () => {
  const m = await mountInbox([agent("a", "needs-you", "asks", { name: "alpha", order: 0 }), agent("b", "working", "editing", { name: "beta", order: 1 })]);
  await open(m, decision("d1", "a"));
  const approve = within(panel()).getByRole("button", { name: "Approve" });
  approve.focus();
  fireEvent.click(approve);
  await send(m, status("a", "working"));
  await waitFor(() => expect(within(panel()).queryByRole("region", { name: "Needs you" })).toBeNull());
  expect(document.activeElement).toBe(within(panel()).getByText("alpha").closest("button"));
});

it("u3770a_an_answered_error_agent_returns_to_needs_you_with_its_count", async () => {
  const m = await mountInbox();
  await open(m, decision("d3", "c"));
  fireEvent.click(within(within(panel()).getByText("gamma").closest("li")!).getByRole("button", { name: "Approve" }));
  await act(() => m.app.emit(cleared("d3", "answered")));
  await waitFor(() => expect(names(groupOf("Needs you"))).toContain("gamma"));
  expect(within(groupOf("Needs you")).getByText("3")).toBeTruthy();
});

it.each((["resume", "capture", "answer"] as const).flatMap((action) =>
  (["dismiss", "acknowledge", "remove", "replace"] as const).map((transition) => [action, transition] as const),
))("p3557c_failure_lifetime_inboxrow_%s_%s", async (action, transition) => {
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

  if (action !== "resume") await open(m, decision("d1", "a"));

  m.app.handlers["decision.capture"] = ({ id }) => {
    if (action === "capture") throw new Error("capture refused");

    return { daemon: "d", agent: "a", attempt: "1", decision: id };
  };

  m.app.handlers["decision.answer"] = () => { throw new Error("answer refused"); };

  const label = action === "resume" ? "Retry" : "Approve";
  const message = action === "resume" ? "resume a refused" : `${action} refused`;

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

    m.app.handlers["decision.capture"] = ({ id }) => ({ daemon: "d", agent: "a", attempt: "1", decision: id });
    m.app.handlers["decision.answer"] = async () => { await reply;

 return null; };

    fireEvent.click(within(row("alpha")).getByRole("button", { name: label }));
    expect(within(row("alpha")).getByRole("alert").textContent).toBe(message);
    acknowledge();
    await waitFor(() => expect(within(panel()).queryByText(message)).toBeNull());

    if (action !== "resume") await act(() => m.app.emit(cleared("d1", "answered")));
  }

  if (transition === "replace") await open(m, { ...decision("d2", "a"), opened_at: 2 });

  if (transition === "remove") {
    m.app.handlers["rail.tree"] = () => [nodes[1]!];
    await send(m, event({ name: "rail.changed" }));
    expect(within(panel()).queryByText("alpha")).toBeNull();
    m.app.handlers["rail.tree"] = () => nodes;
    await send(m, event({ name: "rail.changed" }));
  }

  if (head("alpha").getAttribute("aria-expanded") !== "true") fireEvent.click(head("alpha"));

  await waitFor(() => expect(within(row("alpha")).queryByRole("alert")).toBeNull());
  fireEvent.click(head("beta"));
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
