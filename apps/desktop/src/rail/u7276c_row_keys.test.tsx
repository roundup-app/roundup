import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf, settled } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const press = (id: string, key: string) => {
  const row = rowOf(id);

  row.focus();
  fireEvent.keyDown(row, { key, code: key, altKey: true });
};

const moves = (app: Parameters<typeof railCallsTo>[0]) => railCallsTo(app, "rail.move");

const tree = () => [
  workstream("W0", { order: 0 }),
  agent("A0", "idle", "", { parent: "W0", order: 0 }),
  agent("A1", "idle", "", { parent: "W0", order: 1 }),
  workstream("W1", { order: 1 }),
  workstream("W2", { order: 2 }),
];

it("u7276c_alt_up_and_down_move_one_slot_in_the_rail", async () => {
  const m = await mountRail(tree());
  await settled();

  press("W1", "ArrowUp");
  await waitFor(() => expect(moves(m.app)).toEqual([{ id: "W1", parent: null, index: 0 }]));

  press("W0", "ArrowDown");
  await waitFor(() => expect(moves(m.app)).toHaveLength(2));
  // The first move shows at once (W1, W0, W2), so W0 now steps past W2.
  expect(moves(m.app)[1]).toEqual({ id: "W0", parent: null, index: 2 });
});

it("u7276c_alt_right_nests_under_the_row_above", async () => {
  const m = await mountRail([workstream("W0", { order: 0 }), workstream("W1", { order: 1 }), agent("B0", "idle", "", { order: 0 }), agent("B1", "idle", "", { order: 1 })]);
  await settled();

  // An Agent under an Agent and a Workstream under a Workstream are refused; the Agent right below a Workstream becomes its last child.
  press("B1", "ArrowRight");
  press("W1", "ArrowRight");
  await settled();
  expect(moves(m.app)).toEqual([]);

  press("B0", "ArrowRight");
  await waitFor(() => expect(moves(m.app)).toEqual([{ id: "B0", parent: "W1", index: 0 }]));
});

it("u7276c_alt_left_unnests_after_the_parent", async () => {
  const m = await mountRail(tree());
  await settled();

  press("A1", "ArrowLeft");
  await waitFor(() => expect(moves(m.app)).toEqual([{ id: "A1", parent: null, index: 1 }]));
  await waitFor(() => expect(document.activeElement).toBe(rowOf("A1")));
});

it("u7276c_a_refused_or_end_move_calls_nothing", async () => {
  const m = await mountRail(tree());
  await settled();

  press("W0", "ArrowUp");
  press("W2", "ArrowDown");
  press("A0", "ArrowUp");
  press("A1", "ArrowDown");
  press("W0", "ArrowLeft");
  press("A0", "ArrowRight");
  await settled();
  expect(moves(m.app)).toEqual([]);
});
