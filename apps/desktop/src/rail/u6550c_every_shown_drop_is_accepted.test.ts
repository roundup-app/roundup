import fc from "fast-check";
import { expect, it } from "vitest";
import { dropAt, legalDepths, legalGaps, legalSlot, nearestDepth, remainingRows, withDepth } from "../ui/treeDrop";
import { placeable, type PlaceNode } from "./placement";

type Kind = PlaceNode["kind"];

type Outline = { kind: Kind; below: Outline[] };

/** Any tree of the three kinds; `valid` keeps what the Daemon could hold. */
const trees = fc.letrec<{ node: Outline }>(tie => ({
  node: fc.oneof(
    { depthSize: "small" },
    fc.constant<Outline>({ kind: "agent", below: [] }),
    fc.record<Outline>({ kind: fc.constantFrom<Kind>("workstream", "group"), below: fc.array(tie("node"), { maxLength: 3 }) }),
  ),
})).node;

/** Keeps the nodes the Daemon would hold: below a Workstream sit Agents and Groups, below a Group anything, below an Agent an Agent; a Workstream sits only in Groups. */
const valid = (outline: Outline, under: Kind | null, groupsOnly: boolean): Outline | null => {
  if (outline.kind === "workstream" && (under === "workstream" || under === "agent" || !groupsOnly)) return null;

  if (outline.kind === "group" && under === "agent") return null;

  const below = outline.below.flatMap((child) => valid(child, outline.kind, groupsOnly && outline.kind === "group") ?? []);

  return { kind: outline.kind, below };
};

type Row = { id: string; parent: string | null };

const flatten = (roots: Outline[]) => {
  const nodes = new Map<string, PlaceNode>();
  const rows: Row[] = [];

  const walk = (outline: Outline, parent: string | null) => {
    const id = `n${nodes.size}`;

    nodes.set(id, { id, kind: outline.kind, parent });
    rows.push({ id, parent });
    outline.below.forEach((child) => walk(child, id));
  };

  roots.forEach((root) => walk(root, null));

  return { nodes, rows };
};

const shown = fc.array(trees, { minLength: 1, maxLength: 4 }).map((roots) => flatten(roots.flatMap((root) => valid(root, null, true) ?? [])));

it("u6550c_every_shown_drop_is_accepted", () => {
  fc.assert(fc.property(shown, fc.integer({ min: -2, max: 6 }), (tree, wanted) => {
    const { nodes, rows } = tree;
    const withDepths = withDepth(rows);
    const rules = { nests: (id: string) => nodes.get(id)?.kind === "workstream", takes: (id: string, parent: string | null) => placeable(nodes, id, parent) };

    for (const { id } of rows) {
      const remaining = remainingRows(withDepths, id);

      // Every slot and depth the line can show is accepted, and a pointer over any slot, at any depth, resolves to one.
      for (let slot = 0; slot <= remaining.length; slot++) {
        for (const depth of legalDepths(remaining, rules, id, slot)) expect(rules.takes(id, dropAt(remaining, rules.nests, slot, depth).parent)).toBe(true);

        const snapped = legalSlot(remaining, rules, id, slot, 0);
        const depths = legalDepths(remaining, rules, id, snapped);

        expect(depths.length).toBeGreaterThan(0);
        expect(rules.takes(id, dropAt(remaining, rules.nests, snapped, nearestDepth(depths, wanted)).parent)).toBe(true);

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

  const rules = { nests: (id: string) => nodes.get(id)?.kind === "workstream", takes: (id: string, parent: string | null) => placeable(nodes, id, parent) };
  const lifted = [...nodes.values()].filter((node) => node.kind === "workstream");

  for (const { id } of lifted) {
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

it("u6550c_a_lifted_workstream_stops_only_at_root_gaps", () => {
  // W0 with two Agents (the lifted row, folded), W1 with two Agents, W2: the indices a pointer or a key may stop at are the ones outside W1's Agents.
  const { nodes, rows } = flatten([
    { kind: "workstream", below: [] },
    { kind: "workstream", below: [{ kind: "agent", below: [] }, { kind: "agent", below: [] }] },
    { kind: "workstream", below: [] },
  ]);

  const rules = { nests: (id: string) => nodes.get(id)?.kind === "workstream", takes: (id: string, parent: string | null) => placeable(nodes, id, parent) };

  // Drop indices 0..4 of the lifted W0 among [W1, a, b, W2]: before W1, before a, before b, before W2, after W2.
  expect(legalGaps(rows, rules, "n0")).toEqual([true, false, false, true, true]);
});
