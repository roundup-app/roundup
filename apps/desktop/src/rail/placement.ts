import table from "./placement.json";

type Kind = keyof typeof table;

/** The part of a Rail node the placement rule reads. */
export type PlaceNode = { id: string; kind: Kind; parent: string | null };

/**
 * Whether the Daemon's `rail.move` takes `id` under `parent` (null is the root): the kind table in `placement.json`, which
 * `placement_table_is_check_parent` in `crates/agents/src/rail/tests.rs` ties to `check_parent`, plus never into itself.
 * A Group that holds a Workstream is kept to the Workstream's row.
 */
export const placeable = (nodes: ReadonlyMap<string, PlaceNode>, id: string, parent: string | null): boolean => {
  const node = nodes.get(id);

  if (!node) return false;

  const chain = (from: string | null): PlaceNode[] => {
    const out: PlaceNode[] = [];

    for (let at = from === null ? undefined : nodes.get(from); at; at = at.parent === null ? undefined : nodes.get(at.parent)) {
      if (out.includes(at)) break;
      out.push(at);
    }

    return out;
  };

  if (parent === null) return true;

  const above = chain(parent);

  if (!above[0] || above.some((each) => each.id === id)) return false;

  const fits = (kind: Kind): boolean => {
    const rule = table[kind][above[0]!.kind];

    // "chain": under a Group whose own ancestors are all Groups.
    return rule === "chain" ? above.every((each) => each.kind === "group") : rule === true;
  };

  if (!fits(node.kind)) return false;

  return node.kind !== "group" || !holdsWorkstream(nodes, id) || fits("workstream");
};

const holdsWorkstream = (nodes: ReadonlyMap<string, PlaceNode>, id: string): boolean => {
  for (const each of nodes.values()) {
    if (each.kind !== "workstream") continue;

    for (let at: PlaceNode | undefined = each, steps = 0; at && steps <= nodes.size; at = at.parent === null ? undefined : nodes.get(at.parent), steps++) if (at.id === id) return true;
  }

  return false;
};
