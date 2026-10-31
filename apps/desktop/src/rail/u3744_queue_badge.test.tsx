import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { event, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const tree = () => [workstream("w1", { name: "one" }), workstream("w2", { name: "two" }), workstream("w3", { name: "three" })];

const queued = (...entries: { workstream: string; start: { kind: "queued" } | { kind: "afterTodo"; todo: number } }[]) => ({ running: 1, cap: 1, entries });

const badge = (name: string) => rowOf(name).querySelector(".queue-badge")?.textContent ?? null;

const openMenu = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 10, clientY: 10 });

it("u3744_a_queued_row_shows_its_place_or_its_todo_and_loses_it_when_started", async () => {
  let entries = [{ workstream: "w1", start: { kind: "queued" as const } }, { workstream: "w2", start: { kind: "afterTodo" as const, todo: 7 } }];
  const { app } = await mountRail([]);

  app.handlers["rail.tree"] = () => tree();
  app.handlers["workstream.queue"] = () => queued(...entries);
  app.emit(event({ name: "rail.changed" }));

  await waitFor(() => expect(badge("one")).toBe("queued · 1"));
  expect(badge("two")).toBe("after #7");
  expect(badge("three")).toBeNull();

  entries = [entries[1]!];
  app.emit(event({ name: "workstream.queueChanged" }));

  await waitFor(() => expect(badge("one")).toBeNull());
  expect(badge("two")).toBe("after #7");
});

it("u3744_the_row_menu_calls_one_method_per_choice", async () => {
  const { app } = await mountRail([]);

  app.handlers["rail.tree"] = () => tree();
  app.handlers["workstream.queue"] = () => queued({ workstream: "w1", start: { kind: "queued" } }, { workstream: "w2", start: { kind: "queued" } });
  app.handlers["workstream.startNow"] = () => workstream("w1");
  app.handlers["workstream.dequeue"] = () => null;
  app.handlers["workstream.queueMove"] = () => null;
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(badge("two")).not.toBeNull());

  openMenu("two");
  await app.pickMenu("Move up");
  openMenu("one");
  await app.pickMenu("Move down");
  openMenu("two");
  await app.pickMenu("Remove from queue");
  openMenu("one");
  await app.pickMenu("Start now");

  await waitFor(() => expect(railCallsTo(app, "workstream.startNow")).toHaveLength(1));
  expect(railCallsTo(app, "workstream.queueMove")).toEqual([{ workstream: "w2", index: 0 }, { workstream: "w1", index: 1 }]);
  expect(railCallsTo(app, "workstream.dequeue")).toEqual([{ workstream: "w2" }]);
  expect(railCallsTo(app, "workstream.startNow")).toEqual([{ workstream: "w1" }]);
});

it("u3744_a_failure_shows_its_cause_on_the_row", async () => {
  const { app } = await mountRail([]);

  app.handlers["rail.tree"] = () => tree();
  app.handlers["workstream.queue"] = () => queued({ workstream: "w1", start: { kind: "queued" } });
  app.handlers["workstream.startNow"] = () => { throw new RpcError(-32003, "no terminal to start"); };

  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(badge("one")).toBe("queued · 1"));

  openMenu("one");
  await app.pickMenu("Start now");

  expect(await screen.findByText("no terminal to start")).toBeTruthy();
});

it("u3744_the_row_menu_offers_only_the_moves_that_can_act", async () => {
  const { app } = await mountRail([]);

  app.handlers["rail.tree"] = () => tree();
  app.handlers["workstream.queue"] = () => queued({ workstream: "w1", start: { kind: "queued" } }, { workstream: "w2", start: { kind: "queued" } });
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(badge("two")).toBe("queued · 2"));

  openMenu("one");
  expect(app.menuLabels()).toContain("Move down");
  expect(app.menuLabels()).not.toContain("Move up");

  openMenu("two");
  expect(app.menuLabels()).toContain("Move up");
  expect(app.menuLabels()).not.toContain("Move down");
});
