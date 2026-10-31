import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent, event, NOW } from "../testing/nodes";
import { age, elapsed } from "../shelf/Age";
import { mountTodos } from "../todos/testHarness";
import { AskBar } from "../ask/AskBar";
import { ConnectedProjectContext } from "../state/connectedProject";
import { copy } from "../ink/copy";
import { copy as askCopy } from "../ask/copy";
import { copy as shelfCopy } from "../shelf/copy";
import { createNow, DisplayClockContext, NOW_TICK_MS } from "../state/clock";

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => localStorage.clear());

const QUOTA = "Quota used up; add credit";

const since = (minutes: number) => ({ since: Date.now() - minutes * 60_000, finished: "0" });

const NODES: RailNode[] = [
  agent("a", "needs-you", "Waiting for approval", { name: "alpha", order: 0, status: { kind: "needs-you", label: "Waiting for approval", ...since(12) } }),
  agent("b", "blocked", "Needs a decision", { name: "beta", order: 1, status: { kind: "blocked", label: "Needs a decision", ...since(3) } }),
  agent("c", "error", QUOTA, { name: "gamma", order: 2, status: { kind: "error", label: QUOTA, ...since(5) } }),
  agent("d", "done", "finished", { name: "delta", order: 3, status: { kind: "done", label: "finished", ...since(9) } }),
];

const mountInbox = async () => {
  const m = await mountTodos([], true, structuredClone(NODES));
  const now = createNow(() => Date.now(), () => false);

  render(() => <DisplayClockContext.Provider value={now.subscribe}><ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider></DisplayClockContext.Provider>);
  m.connected.showView(null);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });
};

const head = (id: string) => document.querySelector<HTMLElement>(`[data-row$=":${id}"] .inbox-row`)!;

const KINDS = [["a", "Waiting for approval", 12], ["c", QUOTA, 5]] as const;

it("u5231a_reason_and_age_reveal_on_hover_and_focus", async () => {
  await mountInbox();
  expect(screen.queryByRole("tooltip")).toBeNull();

  for (const [id, label, minutes] of KINDS) {
    const reveal = label === QUOTA ? copy.statusAge.minutes(minutes) : copy.statusReveal(label, copy.statusAge.minutes(minutes));

    fireEvent.pointerMove(head(id), { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe(reveal);
    fireEvent.pointerLeave(head(id), { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.keyDown(document, { key: "Tab" });
    head(id).focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe(reveal);
    head(id).blur();
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  }
});

it("u5231a_error_row_adds_age_not_a_second_reason", async () => {
  await mountInbox();
  fireEvent.keyDown(document, { key: "Tab" });
  head("c").focus();
  const tip = await screen.findByRole("tooltip");

  expect(tip.textContent).toBe(copy.statusAge.minutes(5));
  expect(document.body.textContent?.split(QUOTA)).toHaveLength(2);
});

it("u5231b_age_boundaries", () => {
  const A = shelfCopy.age;
  const table: [number, string][] = [[59, A.now], [60, A.minutes(1)], [3599, A.minutes(59)], [3600, A.hours(1)], [86_399, A.hours(23)], [86_400, A.days(1)], [604_799, A.days(6)], [604_800, A.weeks(1)], [2_419_199, A.weeks(3)]];

  for (const [seconds, text] of table) expect(age(0, seconds * 1000)).toBe(text);
  expect(elapsed(0, 2_419_200_000).unit).toBe("date");
  expect(age(5_000, 0)).toBe(A.now);
  expect(age(0, 2_419_200_000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("u5231b_age_ticks_while_shown", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const nodes = [agent("a", "needs-you", "Waiting for approval", { name: "alpha", order: 0, status: { kind: "needs-you", label: "Waiting for approval", since: NOW - 59_000, finished: "0" } })];
  const m = await mountTodos([], true, nodes);
  const now = createNow(() => Date.now(), () => false);

  render(() => <DisplayClockContext.Provider value={now.subscribe}><ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider></DisplayClockContext.Provider>);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });
  fireEvent.keyDown(document, { key: "Tab" });
  head("a").focus();
  expect((await screen.findByRole("tooltip")).textContent).toBe(copy.statusReveal("Waiting for approval", copy.statusAge.now));
  await vi.advanceTimersByTimeAsync(NOW_TICK_MS);
  expect(screen.getByRole("tooltip").textContent).toBe(copy.statusReveal("Waiting for approval", copy.statusAge.minutes(1)));
});

it("u5231b_new_status_event_replaces_label_and_age_together", async () => {
  const m = await mountTodos([], true, structuredClone(NODES));
  const now = createNow(() => Date.now(), () => false);

  render(() => <DisplayClockContext.Provider value={now.subscribe}><ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider></DisplayClockContext.Provider>);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });
  fireEvent.keyDown(document, { key: "Tab" });
  head("a").focus();
  expect((await screen.findByRole("tooltip")).textContent).toBe(copy.statusReveal("Waiting for approval", copy.statusAge.minutes(12)));
  const node = NODES[0]!;

  m.app.emit(event({ name: "agent.status", data: { id: "a", attempt: node.attempt!, status_revision: String(Number(node.status_revision) + 1), status: { kind: "needs-you", label: "Pick a branch", since: Date.now() - 20.5 * 60_000, finished: "0" } } }));
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(copy.statusReveal("Pick a branch", copy.statusAge.minutes(20))));
});

it("u5231c_ticking_age_keeps_typed_input", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const nodes = [agent("a", "needs-you", "Waiting for approval", { name: "alpha", order: 0, status: { kind: "needs-you", label: "Waiting for approval", since: NOW - 59_000, finished: "0" } })];
  const m = await mountTodos([], true, nodes);
  const now = createNow(() => Date.now(), () => false);

  render(() => <DisplayClockContext.Provider value={now.subscribe}><ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider></DisplayClockContext.Provider>);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });
  const input = screen.getByPlaceholderText<HTMLTextAreaElement>(askCopy.askBarPlaceholder);

  fireEvent.input(input, { target: { value: "unfinished" } });
  input.focus();
  const row = head("a");

  fireEvent.pointerMove(row, { pointerType: "mouse" });
  await screen.findByRole("tooltip");
  await vi.advanceTimersByTimeAsync(NOW_TICK_MS);
  expect(screen.getByRole("tooltip").textContent).toBe(copy.statusReveal("Waiting for approval", copy.statusAge.minutes(1)));
  expect(input.value).toBe("unfinished");
  expect(document.activeElement).toBe(input);
  expect(head("a")).toBe(row);
});
