import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent, NOW } from "../testing/nodes";
import { mountTodos } from "../todos/testHarness";
import { AskBar } from "../ask/AskBar";
import { ConnectedProjectContext } from "../state/connectedProject";
import { copy } from "../ink/copy";
import { createNow, DisplayClockContext, NOW_TICK_MS } from "../state/clock";

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => localStorage.clear());

const QUOTA = "Quota used up; add credit";

const since = (minutes: number) => ({ since: Date.now() - minutes * 60_000, finished: "0" });

const NODES: RailNode[] = [
  agent("a", "needs-you", "Waiting for approval", { name: "alpha", order: 0, status: { kind: "needs-you", label: "Waiting for approval", ...since(12) } }),
  agent("b", "working", "Editing Thread.tsx", { name: "beta", order: 1, status: { kind: "working", label: "Editing Thread.tsx", ...since(3) } }),
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

it("u5231a_reason_and_age_reveal_on_hover_and_focus", async () => {
  await mountInbox();
  expect(screen.queryByRole("tooltip")).toBeNull();

  fireEvent.pointerMove(head("a"), { pointerType: "mouse" });
  expect((await screen.findByRole("tooltip")).textContent).toBe(copy.statusReveal("Waiting for approval", copy.statusAge.minutes(12)));
});

it("u5231a_error_row_adds_age_not_a_second_reason", async () => {
  await mountInbox();
  fireEvent.keyDown(document, { key: "Tab" });
  head("c").focus();
  const tip = await screen.findByRole("tooltip");

  expect(tip.textContent).toBe(copy.statusAge.minutes(5));
});

it("u5231a_idle_and_done_rows_reveal_nothing", async () => {
  await mountInbox();
  const row = document.querySelector<HTMLElement>('[data-row^="d:"] .inbox-row');

  if (row) { fireEvent.pointerMove(row, { pointerType: "mouse" }); fireEvent.focusIn(row); }

  await new Promise(done => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
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
