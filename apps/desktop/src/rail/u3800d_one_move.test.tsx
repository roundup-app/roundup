import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf, settled } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

/** `tree-40` in shape: eight Workstreams of three Agents each and eight Agents of no Workstream; the last of those is the row moved. */
const tree40 = () => [
  ...Array.from({ length: 8 }, (_, w) => [workstream(`W${w}`, { order: w }), ...Array.from({ length: 3 }, (_, a) => agent(`A${w}${a}`, "working", "live", { parent: `W${w}`, order: a }))]).flat(),
  ...Array.from({ length: 8 }, (_, f) => agent(`F${f}`, "working", "live", { order: 8 + f })),
];

it("u3800d_one_move_touches_only_its_rows", async () => {
  const nodes = tree40();
  const m = await mountRail(nodes);
  await settled();
  const touched = new Map<string, number>();
  const pending = m.rail.pendingOf;

  m.rail.pendingOf = id => {
    touched.set(id, (touched.get(id) ?? 0) + 1);

    return pending(id);
  };

  m.app.handlers["rail.move"] = params => {
    const at = nodes.findIndex(node => node.id === params.id);
    nodes.splice(at, 1, { ...nodes[at]!, parent: params.parent, order: params.index });
    m.app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });

    return null;
  };

  const row = rowOf("F7");
  row.focus();
  fireEvent.keyDown(row, { key: "m", code: "KeyM" });
  await screen.findByRole("combobox");
  touched.clear();
  fireEvent.click(screen.getByRole("option", { name: "W1" }));
  await m.rail.settled();
  await settled();

  // The moved row, its new Workstream and the sibling whose trunk now runs on below it may redraw; no other row does.
  const rows = [...touched.keys()];
  expect(rows).toContain("F7");
  expect(rows.filter(id => !["F7", "W1", "A12"].includes(id))).toEqual([]);
});
