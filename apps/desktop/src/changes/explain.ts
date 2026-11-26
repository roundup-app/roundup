import { createSignal } from "solid-js";
import type { ExplainForm } from "@contracts/agent/ExplainForm";
import type { Explanation } from "@contracts/agent/Explanation";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import type { LineSelection } from "./lines";

/** U7698b: one ask of the user's: the lines of a file and the form, the comparison and the blob id the file had when it was asked (U7698c's stale), and its answer or the wait for one. */
export type Asked = LineSelection & { path: string; form: ExplainForm; to: "tree" | "branch"; blob: string | null; answer: Explanation | { state: "asking" } };

type Ask = Omit<Asked, "answer" | "to">;

type Place = Omit<Asked, "answer" | "blob">;

const sameAsk = (a: Place, b: Place) => a.to === b.to && a.path === b.path && a.side === b.side && a.start === b.start && a.end === b.end && a.form === b.form;

/** U7698e: an Agent's explanations, kept in the connection's memory for its session (U7675f): closing the view loses none, and a restart drops them. */
export const createExplained = () => createSignal<readonly Asked[]>([]);

type Kept = ReturnType<typeof createExplained>;

/** U7698b: the cause of a failed ask. */
export const explainCause = (answer: Asked["answer"]): string | undefined => answer.state === "failed" ? answer.cause : undefined;

/** U7698b: the text of an answered ask. */
export const explainedText = (answer: Asked["answer"]): string | undefined => answer.state === "explained" ? answer.text : undefined;

/**
 * U7698a: `agent.explain` is asked only by `ask`, the user's action (P9), and never while the same ask waits. A comparison with no Worktree (`to` null) offers none.
 * The Daemon keeps nothing of an answer: each lives in `kept` until the connection ends.
 */
export const createExplanations = (input: { app: AppSeam; id: string; to: () => "tree" | "branch" | null; kept: Kept }) => {
  const [list, setList] = input.kept;

  const put = (next: Asked) => setList(all => [...all.filter(each => !sameAsk(each, next)), next]);

  return {
    offered: () => input.to() !== null,
    /** The asks of `path` in the open comparison. */
    of: (path: string) => list().filter(each => each.path === path && each.to === input.to()),
    ask: (range: Ask) => {
      const to = input.to();
      const asked = to && { ...range, to };

      if (!asked || list().some(each => sameAsk(each, asked) && each.answer.state === "asking")) return;

      put({ ...asked, answer: { state: "asking" } });
      let answer: Explanation | undefined;

      void failureOf(async () => { answer = await input.app.rpc("agent.explain", { id: input.id, to: asked.to, path: range.path, side: range.side, start: range.start, end: range.end, form: range.form }); })
        .then(failure => put({ ...asked, answer: failure !== null || !answer ? { state: "failed", kind: "call", cause: failure ?? "no_answer" } : answer }));
    },
  };
};

export type Explanations = ReturnType<typeof createExplanations>;
