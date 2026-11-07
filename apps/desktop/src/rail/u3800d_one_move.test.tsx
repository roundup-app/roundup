import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { createRailTree } from "./railTree";
import { agent, workstream, NOW } from "../testing/nodes";
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

it("u3800g_focus_lands_on_the_dropped_row", async () => {
  const nodes = tree40();
  const m = await mountRail(nodes);
  await settled();

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
  fireEvent.click(screen.getByRole("option", { name: "W1" }));
  await m.rail.settled();
  await settled();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  expect(document.activeElement).toBe(rowOf("F7"));
});

it("u3800d_a_key_straight_after_a_move_walks_the_new_order", async () => {
  const nodes = tree40();
  const m = await mountRail(nodes);
  await settled();

  // The Daemon answers in the move's own task, so focus is back on F7 before any task the redraw queued; ArrowDown lands then.
  const press = (event: FocusEvent) => {
    if (event.target !== rowOf("F7")) return;
    document.removeEventListener("focusin", press);
    fireEvent.keyDown(rowOf("F7"), { key: "ArrowDown", code: "ArrowDown" });
  };

  m.app.handlers["rail.move"] = params => {
    document.addEventListener("focusin", press);
    const at = nodes.findIndex(node => node.id === params.id);
    nodes.splice(at, 1, { ...nodes[at]!, parent: params.parent, order: params.index });
    m.app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });

    return null;
  };

  fireEvent.click(rowOf("F7"));
  rowOf("F7").focus();
  fireEvent.keyDown(rowOf("F7"), { key: "m", code: "KeyM" });
  await screen.findByRole("combobox");
  fireEvent.click(screen.getByRole("option", { name: "W1" }));
  await m.rail.settled();
  await settled();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  // F7 now ends W1, so the row after it is W2.
  expect(document.activeElement).toBe(rowOf("W2"));
  expect(m.rail.selected()).toBe("F7");
});

it("u3800g_collection_survives_a_redraw_that_leaves_the_tree_as_it_was", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => tree40();
  const [now, setClock] = createSignal(NOW);
  const clock = createRoot(() => createMemo(now));
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => true, clock);

  createRoot(dispose => {
    const tree = createRailTree(connected, () => new Set(), () => undefined);
    const collection = tree.collection();
    const expanded = tree.expanded();
    setClock(NOW + 1000);
    expect(tree.collection()).toBe(collection);
    expect(tree.expanded()).toBe(expanded);
    dispose();
  });
});

it("u3800d_a_redraw_that_shows_a_row_fewer_rebuilds_the_collection_at_once", async () => {
  const nodes = tree40();
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => structuredClone(nodes);
  const clock = createRoot(() => createMemo(() => NOW));
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => true, clock);
  const holds: boolean[] = [];

  const dispose = createRoot(dispose => {
    const tree = createRailTree(connected, () => new Set(), () => undefined);
    // Each redraw records, in its own update, whether the collection still holds F7.
    createEffect(on(tree.rows, () => holds.push(tree.collection().findNode("F7") !== undefined)));

    return dispose;
  });

  nodes.splice(nodes.findIndex(node => node.id === "F7"), 1);
  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  await connected.rail.settled();
  await settled();

  expect(holds).toEqual([true, false]);
  dispose();
});
