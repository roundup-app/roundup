import { createMemo, createSignal, untrack } from "solid-js";
import type { ExplainForm } from "@contracts/agent/ExplainForm";
import type { Explanation } from "@contracts/agent/Explanation";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { LineExplanation } from "@contracts/agent/LineExplanation";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import { reachKey, type Reach } from "./owned";
import { sourceAt, type LineSelection } from "./lines";

/** U7698b: one ask of the user's: the lines of a file and the form, the comparison and the blob id the file had when it was asked (U7698c's stale), and its answer or the wait for one. U7699: an explanation of the readback is one, answered, with the lines' `source` it was written against in place of a blob id. */
export type Asked = LineSelection & { path: string; form: ExplainForm; at: string; blob: string | null; source?: string; answer: Explanation | { state: "asking" } };

type Ask = Omit<Asked, "answer" | "at">;

type Place = Omit<Asked, "answer" | "blob">;

const sameAsk = (a: Place, b: Place) => a.at === b.at && a.path === b.path && a.side === b.side && a.start === b.start && a.end === b.end && a.form === b.form;

/** U7698e: an Agent's explanations, kept in the connection's memory for its session (U7675f): closing the view loses none, and a restart drops them. */
export const createExplained = () => createSignal<readonly Asked[]>([]);

type Kept = ReturnType<typeof createExplained>;

/** U7699b: whether the file's text at an explanation's lines no longer reads as the `source` it was written against (U2540b's older-context rule); a file not yet read has not changed. */
export const changedFrom = (value: FileComparison | undefined, at: LineSelection, source: string) => value !== undefined && (sourceAt(value, at) ?? "").replaceAll("\r", "") !== source;

/** U7698b: the cause of a failed ask. */
export const explainCause = (answer: Asked["answer"]): string | undefined => answer.state === "failed" ? answer.cause : undefined;

/** U7698b: the text of an answered ask. */
export const explainedText = (answer: Asked["answer"]): string | undefined => answer.state === "explained" ? answer.text : undefined;

/**
 * U7698a: `agent.explain` is asked only by `ask`, the user's action (P9), and never while the same ask waits. A comparison with no Worktree (`to` null) offers none.
 * The Daemon keeps nothing of an answer: each lives in `kept` until the connection ends.
 */
export const createExplanations = (input: { app: AppSeam; id: string; at: () => Reach | null; kept: Kept; read: () => readonly LineExplanation[] }) => {
  const [list, setList] = input.kept;

  // U7699a: the readback's explanations as answered asks of the open comparison; the Daemon's result is the only memory they have.
  const remarks = createMemo((): readonly Asked[] => {
    const at = reachKey(input.at());

    return at ? input.read().map(each => ({ path: each.path, side: "new" as const, start: each.start, end: each.end, form: "words" as const, at, blob: null, source: each.source, answer: { state: "explained" as const, form: "words" as const, text: each.text } })) : [];
  });

  const put = (next: Asked) => setList(all => [...all.filter(each => !sameAsk(each, next)), next]);

  return {
    offered: () => input.at() !== null,
    /** The asks of `path` in the open comparison; an ask of the same lines replaces the readback's explanation of them (U7699b). */
    of: (path: string) => {
      const asked = list().filter(each => each.path === path && each.at === reachKey(input.at()));

      return [...asked, ...remarks().filter(each => each.path === path && !asked.some(kept => sameAsk(kept, each)))];
    },
    ask: (range: Ask) => {
      const reach = untrack(input.at);
      const asked = reach && { ...range, at: reachKey(reach) ?? "" };

      if (!reach || !asked || list().some(each => sameAsk(each, asked) && each.answer.state === "asking")) return;

      put({ ...asked, answer: { state: "asking" } });
      let answer: Explanation | undefined;

      void failureOf(async () => { answer = await input.app.rpc("agent.explain", { id: input.id, ...reach, path: range.path, side: range.side, start: range.start, end: range.end, form: range.form }); })
        .then(failure => put({ ...asked, answer: failure !== null || !answer ? { state: "failed", kind: "call", cause: failure ?? "no_answer" } : answer }));
    },
  };
};

export type Explanations = ReturnType<typeof createExplanations>;

/** U7698b: the explanation under the last line of the range a user asked about. */
export type Explaining = { explaining: true; side: "old" | "new"; start: number; end: number; asked: Asked };

/**
 * U7698a, U7698c: one file's asks as marks Pierre keys by identity, the user's ask of lines, and whether the file changed since an ask (the blob id it has now).
 * An answer asks again for its own range.
 */
export const createExplaining = (input: { explain: () => Explanations | undefined; path: () => string; blob: () => string | null | undefined; value: () => FileComparison | undefined; selection: () => LineSelection }) => {
  const marks = createMemo((): readonly Explaining[] => (input.explain()?.of(input.path()) ?? []).map(asked => ({ explaining: true as const, side: asked.side, start: asked.start, end: asked.end, asked })), { equals: (a, b) => a.length === b.length && a.every((each, at) => each.asked === b[at]?.asked) });

  return {
    marks,
    ask: (form: ExplainForm, at: LineSelection = input.selection()) => input.explain()?.ask({ path: input.path(), side: at.side, start: at.start, end: at.end, form, blob: input.blob() ?? null }),
    stale: (asked: Asked) => asked.source === undefined ? (input.blob() ?? null) !== asked.blob : changedFrom(input.value(), asked, asked.source),
  };
};

export type FileExplaining = ReturnType<typeof createExplaining>;
