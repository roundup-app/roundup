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
