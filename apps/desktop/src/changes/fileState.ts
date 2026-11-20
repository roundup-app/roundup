import { copy } from "./copy";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { LineSelection } from "./lines";
import { drawsLines, imageHidden, imageSides, imageSizes } from "./images";

/** U7675b: a side over this many lines is offered with Show anyway, not drawn at once. */
const TOO_LARGE_LINES = 20000;

/** Why a text comparison draws no lines: only its mode changed, it is too large, or only whitespace differs. */
export type Hidden = "mode" | "large" | "whitespace";

const lineCount = (text: string) => text.split("\n").length;

const withoutSpace = (text: string) => text.replace(/\s+/g, "");

/** U7675b: the reason `value` draws no lines, unless the reader asked to see it (`revealed`). */
export const hiddenKind = (value: FileComparison | undefined, revealed: Hidden | undefined): Hidden | null => {
  if (value?.status == null || value.old.kind !== "text" || value.new.kind !== "text") return null;
  const { text: before } = value.old;
  const { text: after } = value.new;

  const reasons: [Hidden, () => boolean][] = [
    ["mode", () => before === after],
    ["large", () => Math.max(lineCount(before), lineCount(after)) > TOO_LARGE_LINES],
    ["whitespace", () => withoutSpace(before) === withoutSpace(after)],
  ];

  return reasons.find(([kind, applies]) => revealed !== kind && applies())?.[0] ?? null;
};

const HIDDEN_NOTICE = { mode: copy.modeOnly, whitespace: copy.noDifference, large: copy.tooLarge } as const;

type NoticeInput = {
  value: FileComparison | undefined;
  hidden: Hidden | null;
  loading: boolean;
  slow: boolean;
  failed: boolean;
  coarse: boolean;
  selection: LineSelection;
  path: string;
};

export const selectedNotice = ({ side, start, end }: LineSelection) => copy.selectedLines(side, start === end ? `${start}` : `${start}–${end}`, start === end);

/** The line under the file's header: what the reader waits for, what is not drawn, or the selected lines. */
export const noticeFor = (input: NoticeInput): string | null => {
  const { value } = input;

  if (input.loading && input.slow) return copy.loadingFile(input.path);

  if (!value) return input.loading || input.failed ? null : copy.diffNotLoaded;

  if (value.status === null) return copy.noDifference;

  if (input.hidden) return HIDDEN_NOTICE[input.hidden];

  if (imageSides(value)) {
    const image = imageHidden(value);

    return image === "mode" ? copy.modeOnly : image === "large" ? copy.withSizes(copy.tooLarge, imageSizes(value)) : null;
  }

  if (!drawsLines(value)) return copy.binaryDiff;

  return input.coarse ? copy.replacementDiff : selectedNotice(input.selection);
};

/** Two reads of one comparison that differ in no revision, path, status or kind: the pane keeps the earlier one. */
export const sameRead = (previous: FileComparison, next: FileComparison) => previous.base === next.base && previous.oldPath === next.oldPath && previous.newPath === next.newPath
  && previous.status === next.status && previous.old.kind === next.old.kind && previous.new.kind === next.new.kind && sameRevisions(previous, next);

/** U7675d: a file's first line: on the new side, else on the old side of a deleted file. */
export const firstLine = (value: FileComparison): LineSelection => ({ side: value.new.kind === "absent" ? "old" : "new", start: 1, end: 1 });

/** What a comparison reads: its base and the two revisions it compares. */
export const revisionOf = (value: FileComparison) => [value.base, value.old.revision, value.new.revision].join(" ");

/** The same two revisions of the same two paths from the same base. */
export const sameRevisions = (left: FileComparison, right: FileComparison) => left.oldPath === right.oldPath && left.newPath === right.newPath && left.base === right.base
  && left.old.revision === right.old.revision && left.new.revision === right.new.revision;
