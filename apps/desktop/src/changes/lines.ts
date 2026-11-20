import type { FileDiffMetadata } from "@pierre/diffs";

/** U7675e: where a run of added or removed lines begins: the side holding its first line, and the old and new line numbers it starts at. */
export type ChangeStart = { side: "old" | "new"; at: { old: number; new: number } };

/** U7675e: each run of added or removed lines in `diff`, in order, from the library's own parse of the patch. */
export const changeStarts = (diff: FileDiffMetadata): ChangeStart[] => diff.hunks.flatMap(hunk => hunk.hunkContent.flatMap(block => block.type === "change"
  ? [{ side: block.deletions > 0 ? "old" as const : "new" as const, at: { old: block.deletionLineIndex + 1, new: block.additionLineIndex + 1 } }]
  : []));

/** U7675e: the index of the last change that begins at or before the selected line, or -1 before the first. */
export const changeAt = (starts: readonly ChangeStart[], selection: { side: "old" | "new"; start: number }): number => starts.findLastIndex(each => each.at[selection.side] <= selection.start);

/** U7675d: the focused line, or the run of lines, on one side of the diff. */
export type LineSelection = { side: "old" | "new"; start: number; end: number };

/** U7675d: one file's place in the diff: its scroll offset and focused line, kept for the comparison (`revision`) it was left in. */
export type Place = { revision: string; scroll: number; selection: LineSelection };

/** U7675d, U7675f: each file's place, kept while the view is open and, per Agent, for the connection's session. */
export type Places = { get: (path: string) => Place | undefined; set: (path: string, place: Place) => void };

/** U7675d: the place a file opens at: the one kept for this comparison, else its top and `first` line; a file whose comparison changed starts at its top. */
export const placeOf = (places: Places | undefined, path: string, revision: string, first: LineSelection): Place => {
  const kept = places?.get(path);

  return kept?.revision === revision ? kept : { revision, scroll: 0, selection: first };
};

/** The side's name in `@pierre/diffs`. */
export const sideName = (side: "old" | "new"): "deletions" | "additions" => side === "old" ? "deletions" : "additions";

/** U7692b: a run of unchanged lines the diff folds, as the half-open ranges `[from, to)` it holds on each side and the library's own index and step for it. */
export type Fold = { index: number; step: "up" | "down" | "both"; old: [number, number]; new: [number, number] };

/** The first line after a hunk's side, one-based, as the library counts it. */
const after = (start: number, count: number) => start + (count === 0 ? 0 : count - 1) + 1;

/** U7692b: each fold of `diff`, in order: before the first change, between two, and after the last. A leading fold opens toward its change, a trailing one from its change, and the rest from both ends, as the library's separator does. */
export const foldsOf = (diff: FileDiffMetadata): Fold[] => {
  const last = diff.hunks.at(-1);

  const leading = diff.hunks.map((hunk, index): Fold => {
    const to = { old: hunk.deletionStart + (hunk.deletionCount === 0 ? 1 : 0), new: hunk.additionStart + (hunk.additionCount === 0 ? 1 : 0) };

    return { index, step: index === 0 ? "down" : "both", old: [to.old - hunk.collapsedBefore, to.old], new: [to.new - hunk.collapsedBefore, to.new] };
  });

  if (!last) return leading;
  const from = { old: after(last.deletionStart, last.deletionCount), new: after(last.additionStart, last.additionCount) };
  const rest = diff.additionLines.length - from.new + 1;

  return rest > 0 ? [...leading, { index: diff.hunks.length, step: "up", old: [from.old, from.old + rest], new: [from.new, from.new + rest] }] : leading;
};

/** U7692b: the fold V opens: of those with lines still hidden, the first one after the focused line, else the last before it. */
export const nearestFold = (folds: readonly Fold[], selection: { side: "old" | "new"; start: number }, hidden: (fold: Fold) => boolean): Fold | undefined => {
  const open = folds.filter(hidden);

  return open.find(fold => fold[selection.side][1] > selection.start) ?? open.at(-1);
};
