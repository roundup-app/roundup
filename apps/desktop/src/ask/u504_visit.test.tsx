import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Event } from "@contracts/Event";
import { door } from "../testing/nodes";
import { visitStorage } from "../state/visit";
import { ask, input, mountAskBar, press } from "./askFixture";
import { copy } from "./copy";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const actor: Event["actor"] = { kind: "user", id: "you", parent: null };

const tree = () => [door("m", "idle", "ready", { name: "Maker" })];

const completed = (seq: number, turn: string): Event => ({ seq, actor, name: "agent.completed", data: { maker: "m", attempt: "a1", turn } });

const rows = () => [...document.querySelectorAll(".change-row")];

const settled = () => waitFor(() => expect(document.querySelector(".changes")?.getAttribute("aria-busy")).toBe("false"));

const quiet = () => document.querySelector<HTMLElement>(".overview-quiet[data-last-visit]");

it("u504_last_visit_survives_reload_and_project_switch", async () => {
  const a = `/visit-a-${crypto.randomUUID()}`;
  const b = `/visit-b-${crypto.randomUUID()}`;

  // A's first visit saves a boundary; B keeps its own.
  const first = await mountAskBar([], null, tree(), false, a);
  await settled();
  await waitFor(() => expect(visitStorage(a).restore().status).toBe("restored"));
  expect(quiet()?.dataset.lastVisit).toBe("first");
  first.unmount();

  // A change while away is a row on return, and that visit advances A's boundary only after it renders.
  const second = await mountAskBar([], null, tree(), false, a);
  await settled();
  second.app.emit(completed(1, "t1"));
  await waitFor(() => expect(rows()).toHaveLength(1));
  await waitFor(() => expect(visitStorage(a).restore()).toMatchObject({ status: "restored", value: { seq: 1 } }));
  second.unmount();

  // Reload with no changes: one quiet line naming the retained time, no rows.
  const third = await mountAskBar([], null, tree(), false, a);
  await settled();
  expect(rows()).toHaveLength(0);
  expect(quiet()?.dataset.lastVisit).not.toBe("first");
  third.unmount();

  // Project switch: B has no boundary of A's, and A's stays.
  await mountAskBar([], null, tree(), false, b);
  await settled();
  expect(quiet()?.dataset.lastVisit).toBe("first");
  expect(visitStorage(a).restore()).toMatchObject({ status: "restored", value: { seq: 1 } });
});

it("u504_background_reads_do_not_advance_last_visit", async () => {
  const path = `/visit-bg-${crypto.randomUUID()}`;
  const { app, connected } = await mountAskBar([], "m", tree(), false, path);

  // A Terminal stays foreground: Events arrive, nothing is a visit.
  app.emit(completed(1, "t1"));
  await connected.rail.settled();
  expect(document.querySelector(".changes")).toBeNull();
  expect(visitStorage(path).restore().status).toBe("missing");

  connected.rail.select(null);
  await settled();
  await waitFor(() => expect(visitStorage(path).restore().status).toBe("restored"));
});

it("u504_first_visit_and_observation_failure", async () => {
  const path = `/visit-fail-${crypto.randomUUID()}`;
  const { app, connected } = await mountAskBar([], null, tree(), false, path);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });

  // A refused boundary write is shown with its retry; the list never claims the visit was kept.
  await settled();

  const retry = await waitFor(() => {
    const found = document.querySelector<HTMLButtonElement>(".changes .reserved-line button");
    expect(found).not.toBeNull();

    return found!;
  });

  write.mockRestore();
  fireEvent.click(retry);
  await waitFor(() => expect(visitStorage(path).restore().status).toBe("restored"));
  await waitFor(() => expect(document.querySelector(".changes .reserved-line button")).toBeNull());

  // A refused read is shown instead of the quiet line, and nothing is sent or started.
  app.handlers["rail.tree"] = () => { throw new Error("tree refused"); };

  await connected.rail.refresh().catch(() => {});
  await waitFor(() => expect(document.querySelector(".changes .reserved-line button")).not.toBeNull());
  expect(quiet()).toBeNull();
  expect(app.calls.filter(call => ["ask.send", "agent.start", "terminal.write"].includes(call.method))).toEqual([]);
});

it("u504_events_expired_names_the_unavailable_history", async () => {
  const path = `/visit-gap-${crypto.randomUUID()}`;
  const first = await mountAskBar([], null, tree(), false, path);
  await settled();
  await waitFor(() => expect(visitStorage(path).restore().status).toBe("restored"));
  first.unmount();
  await visitStorage(path).write({ seq: 3, at: Date.now() });

  // The log now starts at 9: Events 4 to 8 are gone, so only the kept range is replayed.
  const { app } = await mountAskBar([], null, tree(), false, path);
  await settled();
  app.emit(completed(9, "t9"));
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(document.querySelector(".changes .reserved-line")?.textContent).toBe(copy.historyUnavailable);
});

it("u504_enter_shows_the_row_before_send_returns", async () => {
  const { app } = await mountAskBar([], null, tree());
  let accept!: (value: ReturnType<typeof ask>) => void;

  app.handlers["ask.send"] = () => new Promise(resolve => { accept = resolve; });
  fireEvent.input(input()!, { target: { value: "review the build" } });
  press("Enter", {}, input()!);

  // The row is there while intake is still pending.
  await waitFor(() => expect(app.calls.filter(call => call.method === "ask.send")).toHaveLength(1));
  expect(document.querySelectorAll(".ask-row")).toHaveLength(1);
  accept(ask("accepted", 1, [{ text: "review the build", state: "queued", placement: { kind: "routed", workstream: "m" } }]));
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(1));
});
