/** A row of the caller's tree, in display order. */
export type TreeRow = { id: string; parent: string | null };

/** Where a drag would land: the parent, the index among that parent's other children, and the depth the drop line sits at. */
export type SortableDrop = { parent: string | null; index: number; depth: number };

/** What a tree's owner says about its drops: which rows take a child, and which parents take a dragged row. A drop line shows only slots `accepts` takes, and a pointer or key over any other snaps to the nearest one. */
export type DropRules = {
  nests: (id: string) => boolean;
  accepts?: ((id: string, parent: string | null) => boolean) | undefined;
};

export type DepthRow = TreeRow & { depth: number };

export const withDepth = (rows: readonly TreeRow[]): DepthRow[] => {
  const depths = new Map<string, number>();

  return rows.map((row) => {
    const depth = row.parent === null ? 0 : (depths.get(row.parent) ?? -1) + 1;

    depths.set(row.id, depth);

    return { ...row, depth };
  });
};

/** The rows without the dragged row and the rows that move with it, which are not drop targets. */
export const remainingRows = (rows: readonly DepthRow[], dragged: string): DepthRow[] => {
  const moving = new Set([dragged]);

  for (const row of rows) if (row.parent !== null && moving.has(row.parent)) moving.add(row.id);

  return rows.filter((row) => !moving.has(row.id));
};

type DepthRange = { min: number; max: number };

/** The parent of a drop in gap `slot` of `rows` at `depth`. */
const parentAt = (rows: readonly DepthRow[], slot: number, depth: number): string | null => {
  const above = rows[slot - 1];

  if (!above) return null;

  if (depth > above.depth) return above.id;

  return rows.slice(0, slot).findLast((row) => row.depth === depth)?.parent ?? null;
};

/** The depths a drop in gap `slot` (0 is above the first row) of `rows` can have. */
const depthsAt = (rows: readonly DepthRow[], nests: (id: string) => boolean, slot: number): DepthRange => {
  const above = rows[slot - 1];
  const below = rows[slot];

  if (!above) return { min: 0, max: 0 };

  // A row shown with children takes a drop between them only as a child.
  if (below && below.depth > above.depth) return { min: above.depth + 1, max: above.depth + 1 };

  return { min: below?.depth ?? 0, max: above.depth + (nests(above.id) ? 1 : 0) };
};

/** The depths of gap `slot` the tree's owner takes for `dragged`, shallowest first. */
export const legalDepths = (rows: readonly DepthRow[], tree: DropRules, dragged: string, slot: number): number[] => {
  const { min, max } = depthsAt(rows, tree.nests, slot);
  const depths: number[] = [];

  for (let depth = min; depth <= max; depth++) if (!tree.accepts || tree.accepts(dragged, parentAt(rows, slot, depth))) depths.push(depth);

  return depths;
};

/** The legal depth nearest `wanted`, the shallower on a tie. */
export const nearestDepth = (depths: readonly number[], wanted: number): number => depths.reduce((best, depth) => Math.abs(depth - wanted) < Math.abs(best - wanted) ? depth : best, depths[0]!);

/** The gap nearest `slot` with a legal depth; `toward` (1 down, -1 up) prefers that side, 0 the nearer. Gap 0 is the root, which every row takes. */
export const legalSlot = (rows: readonly DepthRow[], tree: DropRules, dragged: string, slot: number, toward: number): number => {
  const gaps = Array.from({ length: rows.length + 1 }, (_, gap) => gap)
    .sort((a, b) => (toward === 0 ? 0 : Number((a - slot) * toward < 0) - Number((b - slot) * toward < 0)) || Math.abs(a - slot) - Math.abs(b - slot) || a - b);

  return gaps.find((gap) => legalDepths(rows, tree, dragged, gap).length > 0) ?? 0;
};

/** The drop for gap `slot` of `rows` with the pointer at `depth`, clamped to the depths the gap allows. `rows` holds neither the dragged row nor what moves with it. */
export const dropAt = (rows: readonly DepthRow[], nests: (id: string) => boolean, slot: number, depth: number): SortableDrop => {
  const above = rows[slot - 1];

  if (!above) return { parent: null, index: 0, depth: 0 };

  const { min, max } = depthsAt(rows, nests, slot);
  const wanted = Math.min(Math.max(depth, min), max);

  if (wanted > above.depth) return { parent: above.id, index: 0, depth: wanted };

  const anchor = rows.slice(0, slot).findLast((row) => row.depth === wanted);

  if (!anchor) throw new Error(`no row at depth ${wanted} above gap ${slot}`);

  const siblings = rows.filter((row) => row.parent === anchor.parent);

  return { parent: anchor.parent, index: siblings.findIndex((row) => row.id === anchor.id) + 1, depth: wanted };
};

