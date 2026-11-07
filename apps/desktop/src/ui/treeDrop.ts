/** A row of the caller's tree, in display order. */
export type TreeRow = { id: string; parent: string | null };

/** Where a drag would land: the parent, the index among that parent's other children, and the depth the drop line sits at. */
export type SortableDrop = { parent: string | null; index: number; depth: number };

export type DepthRow = TreeRow & { depth: number };

export const withDepth = (rows: readonly TreeRow[]): DepthRow[] => {
  const depths = new Map<string, number>();

  return rows.map((row) => {
    const depth = row.parent === null ? 0 : (depths.get(row.parent) ?? -1) + 1;

    depths.set(row.id, depth);

    return { ...row, depth };
  });
};

/** What a tree's owner says about its drops: which rows take a child, and which parents take a dragged row. A drop line shows only slots `takes` allows, and a pointer or key over any other snaps to the nearest one. */
export type DropRules = {
  nests: (id: string) => boolean;
  takes?: ((id: string, parent: string | null) => boolean) | undefined;
};

/** The rows without the dragged row and the rows that move with it, which are not drop targets. */
export const remainingRows = (rows: readonly DepthRow[], dragged: string): DepthRow[] => {
  const moving = new Set([dragged]);

  for (const row of rows) if (row.parent !== null && moving.has(row.parent)) moving.add(row.id);

  return rows.filter((row) => !moving.has(row.id));
};

type DepthRange = { min: number; max: number };

/** The depths a drop in gap `slot` (0 is above the first row) of `rows` can have. */
export const depthsAt = (rows: readonly DepthRow[], nests: (id: string) => boolean, slot: number): DepthRange => {
  const above = rows[slot - 1];
  const below = rows[slot];

  if (!above) return { min: 0, max: 0 };

  // A row shown with children takes a drop between them only as a child.
  if (below && below.depth > above.depth) return { min: above.depth + 1, max: above.depth + 1 };

  return { min: below?.depth ?? 0, max: above.depth + (nests(above.id) ? 1 : 0) };
};

/** The parent of a drop in gap `slot` of `rows` at `depth`. */
const parentAt = (rows: readonly DepthRow[], slot: number, depth: number): string | null => {
  const above = rows[slot - 1];

  if (!above) return null;

  if (depth > above.depth) return above.id;

  return rows.slice(0, slot).findLast((row) => row.depth === depth)?.parent ?? null;
};

/** The depths of gap `slot` the tree's owner takes for `dragged`, shallowest first. */
export const legalDepths = (rows: readonly DepthRow[], tree: DropRules, dragged: string, slot: number): number[] => {
  const { min, max } = depthsAt(rows, tree.nests, slot);
  const depths: number[] = [];

  for (let depth = min; depth <= max; depth++) if (!tree.takes || tree.takes(dragged, parentAt(rows, slot, depth))) depths.push(depth);

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

/** Whether each drop index of `dragged` in `tree` has a gap the tree's owner takes. */
export const legalGaps = (tree: readonly TreeRow[], rules: DropRules, dragged: string): boolean[] => {
  const rows = withDepth(tree);
  const remaining = remainingRows(rows, dragged);
  const kept = new Set(remaining.map((row) => row.id));
  const others = rows.filter((row) => row.id !== dragged);
  const ok: boolean[] = [];
  let gap = 0;

  for (let at = 0; at <= others.length; at++) {
    ok.push(legalDepths(remaining, rules, dragged, gap).length > 0);

    if (others[at] && kept.has(others[at]!.id)) gap++;
  }

  return ok;
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

/** The gap before index `index` of the dragged row among the rows that stay put when it moves, with every row's depth and the dragged row's own. */
export const gapAt = (tree: readonly TreeRow[], dragged: string, index: number) => {
  const rows = withDepth(tree);
  const remaining = remainingRows(rows, dragged);
  const remainingIds = new Set(remaining.map((row) => row.id));
  const slot = rows.filter((row) => row.id !== dragged).slice(0, index).filter((row) => remainingIds.has(row.id)).length;
  const own = rows.find((row) => row.id === dragged);

  if (!own) throw new Error(`no row ${dragged}`);

  return { rows, remaining, slot, own };
};

/** Releasing the row where it already sits changes nothing. */
export const isInPlace = (rows: readonly DepthRow[], dragged: string, drop: SortableDrop): boolean => {
  const row = rows.find((each) => each.id === dragged);

  if (!row) throw new Error(`no row ${dragged}`);

  return row.parent === drop.parent && rows.filter((each) => each.parent === row.parent).findIndex((each) => each.id === dragged) === drop.index;
};

/** A tree drop's depth changes only once the pointer is this share of a level past the halfway mark between two depths, and changes back only that far past it the other way. */
const DEPTH_BAND_SHARE = 0.25;

/** The band is never narrower than this: a hand at rest wanders about 2 px, so a level squeezed by a short room still holds under it. */
const DEPTH_BAND_MIN_PX = 4;

/** The deepest and the shallowest depth a gap allows step in this far inside the box the pointer picks depths in, so a hand reaches them without leaving it. */
const DEPTH_EDGE_PX = 3;

/** A tree drop steps from `level - 1` to `level` (counted from the dragged row's own depth) once the pointer is at `up` or right of it, and back once it is at `down` or left of it. */
export type DepthStep = { level: number; down: number; up: number };

/**
 * Where a drop's depth steps for a press at `grab`, in a gap that allows `lo` to `hi` levels from the dragged row's own depth.
 * A level is one indent wide where the room allows. Right of the press the deeper levels share the room up to the box's right edge, and left of it the shallower ones share the room to its left edge,
 * so every depth the gap allows is in reach of one drag from any point of a grip, however near the edge it sits.
 */
export const depthSteps = (grab: number, indent: number, lo: number, hi: number, box: { left: number; right: number }): DepthStep[] => {
  const width = (room: number, levels: number) => Math.max(1, Math.min(indent, room / (levels - 0.25)));
  const deeper = hi > 0 ? width(box.right - DEPTH_EDGE_PX - grab, hi) : indent;
  const shallower = lo < 0 ? width(grab - box.left - DEPTH_EDGE_PX, -lo) : indent;
  const band = (size: number) => 2 * Math.max(DEPTH_BAND_SHARE * size, DEPTH_BAND_MIN_PX);
  const steps: DepthStep[] = [];

  for (let level = lo + 1; level <= hi; level++) {
    // A deeper level is reached at its `up`, a shallower one left at its `down`; the band lies on the side back toward the press.
    const at = level > 0 ? grab + (level - 0.25) * deeper : grab - (0.75 - level) * shallower;
    const step = level > 0 ? { level, up: at, down: at - band(deeper) } : { level, down: at, up: at + band(shallower) };
    const below = steps.at(-1);

    // Two narrow sides can cross at the press; a step never comes before the one below it.
    steps.push(below ? { level, up: Math.max(step.up, below.up), down: Math.max(step.down, below.down) } : step);
  }

  return steps;
};

/** The level a pointer at `x` picks, from `level`, in a gap whose steps start at `lo`: it steps up past an `up`, down past a `down`, and holds between them. */
export const stepLevel = (steps: readonly DepthStep[], lo: number, level: number, x: number) => {
  const up = lo + steps.filter(step => x >= step.up).length;
  const down = lo + steps.filter(step => x > step.down).length;

  return up > level ? up : down < level ? down : level;
};

/** How a pointer drag reads a tree drop's depth: one indent in pixels, the levels each gap allows from the dragged row's own depth, and the box the pointer picks depths in. */
export type DepthReading = { indent: number; levels: (slot: number) => { lo: number; hi: number }; box: { left: number; right: number } };

/**
 * How a pointer drag of `dragged` reads its drop's depth: the levels each gap allows from the row's own depth, in the tree's box, else the window.
 * A depth the tree refuses at either end of a gap's range would show no line, so the room goes to the depths between; a gap where it refuses every depth keeps them all.
 */
export const depthReading = (tree: DropRules & { rows: readonly TreeRow[]; indent: number; bounds?: (() => { left: number; right: number } | undefined) | undefined; accepts?: ((move: { id: string; parent: string | null; index: number }) => boolean) | undefined }, dragged: string, windowWidth: number): DepthReading => ({
  indent: tree.indent,
  levels: (index) => {
    const { rows, remaining, slot, own } = gapAt(tree.rows, dragged, index);
    const legal = legalDepths(remaining, tree, dragged, slot);
    const all = depthsAt(remaining, tree.nests, slot);
    const min = legal[0] ?? all.min;
    const max = legal.at(-1) ?? all.max;

    const takes = (depth: number) => {
      const drop = dropAt(remaining, tree.nests, slot, depth);

      return isInPlace(rows, dragged, drop) || tree.accepts?.({ id: dragged, parent: drop.parent, index: drop.index }) !== false;
    };

    let lo = min, hi = max;

    while (hi >= lo && !takes(hi)) hi--;

    if (hi < lo) return { lo: min - own.depth, hi: max - own.depth };

    while (!takes(lo)) lo++;

    return { lo: lo - own.depth, hi: hi - own.depth };
  },
  box: tree.bounds?.() ?? { left: 0, right: windowWidth },
});

/** A cache of whether each drop index of the dragged row has a gap the owner takes, rebuilt when the rows or the dragged row change. */
export const legalIndexOf = () => {
  let cached: { rows: readonly TreeRow[]; dragged: string; ok: boolean[] } | null = null;

  return (tree: DropRules & { rows: readonly TreeRow[] }, dragged: string, index: number): boolean => {
    if (!tree.takes) return true;

    if (cached?.rows !== tree.rows || cached.dragged !== dragged) cached = { rows: tree.rows, dragged, ok: legalGaps(tree.rows, tree, dragged) };

    return cached.ok[index] ?? false;
  };
};

/** The gap and depth a keyboard drag holds. */
export type KeyStop = { slot: number; depth: number };

/** The stop a keyboard drag of `dragged` starts at: the gap and depth the row stands at. */
export const keyStart = (tree: readonly TreeRow[], dragged: string): KeyStop => {
  const rows = withDepth(tree);
  const remaining = remainingRows(rows, dragged);
  const own = rows.find((row) => row.id === dragged);

  if (!own) throw new Error(`no row ${dragged}`);

  return { slot: rows.slice(0, rows.indexOf(own)).filter((row) => remaining.includes(row)).length, depth: own.depth };
};

/** The stop one ArrowLeft (-1) or ArrowRight (1) moves to: the next depth the owner takes for the gap, else where it stands. */
export const keyTurn = (tree: DropRules & { rows: readonly TreeRow[] }, dragged: string, stop: KeyStop, direction: 1 | -1): KeyStop => {
  const depths = legalDepths(remainingRows(withDepth(tree.rows), dragged), tree, dragged, stop.slot);
  const wanted = stop.depth + direction;
  const depth = direction === 1 ? depths.find((each) => each >= wanted) : depths.findLast((each) => each <= wanted);

  return { slot: stop.slot, depth: depth ?? stop.depth };
};

/** The drop a keyboard stop shows. */
export const keyDrop = (tree: DropRules & { rows: readonly TreeRow[] }, dragged: string, stop: KeyStop): SortableDrop => dropAt(remainingRows(withDepth(tree.rows), dragged), tree.nests, stop.slot, stop.depth);

/**
 * The drop for the gap before index `index` of the dragged row: a keyboard drag at its own depth, else `level` levels from the row's own depth.
 * A gap the owner refuses snaps to the nearest one it takes; a key goes on past it the way it was going, from the gap `from` the last resolve took.
 */
export const resolveDrop = (tree: DropRules & { rows: readonly TreeRow[] }, dragged: string, index: number, level: number, keyboard: KeyStop | null, from: number) => {
  const { rows, remaining, slot, own } = gapAt(tree.rows, dragged, index);
  const gap = legalSlot(remaining, tree, dragged, slot, keyboard ? Math.sign(slot - from) : 0);
  const stop = keyboard && keyboard.slot !== gap ? { slot: gap, depth: legalDepths(remaining, tree, dragged, gap)[0]! } : keyboard;
  const depth = stop ? stop.depth : own.depth + level;

  return { rows, gap, keyboard: stop, drop: dropAt(remaining, tree.nests, gap, nearestDepth(legalDepths(remaining, tree, dragged, gap), depth)) };
};
