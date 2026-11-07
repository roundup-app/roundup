import fc from "fast-check";
import { expect, it } from "vitest";
import { dropAt, legalDepths, legalSlot, nearestDepth, remainingRows, withDepth } from "../ui/sortableDrops";
import { placeable, type PlaceNode } from "./placement";

type Kind = PlaceNode["kind"];

type Shape = { kind: Kind; below: Shape[] };

/** Any tree of the three kinds; `valid` keeps what the Daemon could hold. */
const trees = fc.letrec<{ node: Shape }>(tie => ({
  node: fc.oneof(
    { depthSize: "small" },
    fc.constant<Shape>({ kind: "agent", below: [] }),
    fc.record<Shape>({ kind: fc.constantFrom<Kind>("workstream", "group"), below: fc.array(tie("node"), { maxLength: 3 }) }),
  ),
})).node;

/** Keeps the nodes the Daemon would hold: below a Workstream sit Agents and Groups, below a Group anything, below an Agent an Agent; a Workstream sits only in Groups. */
const valid = (shape: Shape, under: Kind | null, groupsOnly: boolean): Shape | null => {
  if (shape.kind === "workstream" && (under === "workstream" || under === "agent" || !groupsOnly)) return null;

  if (shape.kind === "group" && under === "agent") return null;

  const below = shape.below.flatMap((child) => valid(child, shape.kind, groupsOnly && shape.kind === "group") ?? []);

  return { kind: shape.kind, below };
};

const flatten = (roots: Shape[]): { nodes: Map<string, PlaceNode>; rows: { id: string; parent: string | null }[] } => {
  const nodes = new Map<string, PlaceNode>();
  const rows: { id: string; parent: string | null }[] = [];
  const walk = (shape: Shape, parent: string | null) => {
    const id = `n${nodes.size}`;

    nodes.set(id, { id, kind: shape.kind, parent });
    rows.push({ id, parent });
    shape.below.forEach((child) => walk(child, id));
  };

  roots.forEach((root) => walk(root, null));

  return { nodes, rows };
};

const shown = fc.array(trees, { minLength: 1, maxLength: 4 }).map((roots) => flatten(roots.flatMap((root) => valid(root, null, true) ?? [])));

it("u6550c_every_shown_drop_is_accepted", () => {
  fc.assert(fc.property(shown, fc.integer({ min: -2, max: 6 }), (tree, wanted) => {
    const { nodes, rows } = tree;
    const withDepths = withDepth(rows);
    const rules = { nests: (id: string) => nodes.get(id)?.kind === "workstream", accepts: (id: string, parent: string | null) => placeable(nodes, id, parent) };

    for (const { id } of rows) {
      const remaining = remainingRows(withDepths, id);

      // Every slot and depth the line can show is accepted, and a pointer over any slot, at any depth, resolves to one.
      for (let slot = 0; slot <= remaining.length; slot++) {
        for (const depth of legalDepths(remaining, rules, id, slot)) expect(rules.accepts(id, dropAt(remaining, rules.nests, slot, depth).parent)).toBe(true);

        const snapped = legalSlot(remaining, rules, id, slot, 0);
        const depths = legalDepths(remaining, rules, id, snapped);

        expect(depths.length).toBeGreaterThan(0);
        expect(rules.accepts(id, dropAt(remaining, rules.nests, snapped, nearestDepth(depths, wanted)).parent)).toBe(true);

        if (legalDepths(remaining, rules, id, slot).length > 0) expect(snapped).toBe(slot);
      }
    }
  }), { numRuns: 200 });
});

it("u6550b_workstream_has_no_slot_in_a_workstream", () => {
  // Two Workstreams with Agents, an Agent under an Agent, and a Group of a third.
  const { nodes, rows } = flatten([
    { kind: "workstream", below: [{ kind: "agent", below: [{ kind: "agent", below: [] }] }, { kind: "agent", below: [] }] },
    { kind: "workstream", below: [{ kind: "agent", below: [] }] },
    { kind: "group", below: [{ kind: "workstream", below: [] }] },
  ]);

  const rules = { nests: (id: string) => nodes.get(id)?.kind === "workstream", accepts: (id: string, parent: string | null) => placeable(nodes, id, parent) };
  const held = [...nodes.values()].filter((node) => node.kind === "workstream");

  for (const { id } of held) {
    const remaining = remainingRows(withDepth(rows), id);

    for (let slot = 0; slot <= remaining.length; slot++) {
      for (let wanted = 0; wanted <= 3; wanted++) {
        const gap = legalSlot(remaining, rules, id, slot, 0);
        const { parent } = dropAt(remaining, rules.nests, gap, nearestDepth(legalDepths(remaining, rules, id, gap), wanted));
        const under = parent === null ? null : nodes.get(parent)?.kind;

        expect([null, "group"]).toContain(under);
      }
    }
  }
});
