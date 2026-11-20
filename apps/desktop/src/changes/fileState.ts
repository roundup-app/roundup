import type { FileComparison } from "@contracts/agent/FileComparison";

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

  if (before === after) return "mode";

  if (revealed !== "large" && Math.max(lineCount(before), lineCount(after)) > TOO_LARGE_LINES) return "large";

  return revealed !== "whitespace" && withoutSpace(before) === withoutSpace(after) ? "whitespace" : null;
};
