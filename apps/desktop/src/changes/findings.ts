import { createMemo, createSignal, untrack } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Finding } from "@contracts/agent/Finding";
import type { DefectFindings } from "@contracts/agent/DefectFindings";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import { changedFrom } from "./explain";
import { sourceAt } from "./lines";
import type { Found } from "./diffDraw";
import type { Grouped } from "./modules";
import type { Notes } from "./notes";
import { placeCounts } from "./repeats";
import { reachKey, type Reach } from "./owned";

/** U7700b: one pass of the user's: the comparison and the listing's signature it was asked on (U7700b's stale), and its answer or the wait for one. Its findings are the ones not yet kept or dropped. */
type Run = { at: string; signature: string; answer: DefectFindings | { state: "running" } };

/** U7700f: an Agent's pass, kept in the connection's memory for its session (U7675f): closing the view loses none, and a restart drops it. */
export const createFound = () => createSignal<Run | undefined>(undefined);

type Kept = ReturnType<typeof createFound>;

/**
 * U7700a: `agent.findDefects` is asked only by `ask`, the user's action (P9), and never while a pass runs. A comparison with no Worktree (`to` null) offers none.
 * The Daemon keeps nothing of an answer: it lives in `kept` until the connection ends, and a pass that lands after the user asked again is dropped.
 * `totals` counts each listed item's findings for its row (U7700c).
 */
export const createFindings = (input: { app: AppSeam; id: string; at: () => Reach | null; grouped: () => Grouped; signature: () => string; kept: Kept; notes: Notes }) => {
  const [kept, setKept] = input.kept;

  /** The pass of the open comparison; another `at` shows none. */
  const pass = createMemo(() => {
    const run = kept();

    return run?.at === reachKey(input.at()) ? run : undefined;
  });

  const answer = () => pass()?.answer;

  const list = (): readonly Finding[] => {
    const run = answer();

    return run?.state === "found" ? run.findings : [];
  };

  const totals = createMemo(() => placeCounts(input.grouped(), list()));

  /** U7700d: a finding leaves the list once the user decides it. */
  const drop = (finding: Finding) => setKept(run => run?.answer.state === "found" ? { ...run, answer: { ...run.answer, findings: run.answer.findings.filter(each => each !== finding) } } : run);

  const ask = () => {
    const at = untrack(input.at);

    if (!at || answer()?.state === "running") return;
    const asked: Run = { at: reachKey(at) ?? "", signature: input.signature(), answer: { state: "running" } };

    setKept(asked);
    let landed: DefectFindings | undefined;

    void failureOf(async () => { landed = await input.app.rpc("agent.findDefects", { id: input.id, ...at }); })
      .then(failure => setKept(run => run === asked ? { ...asked, answer: failure !== null || !landed ? { state: "failed", kind: "call", cause: failure ?? "no_answer" } : landed } : run));
  };

  return {
    offered: () => input.at() !== null,
    /** Not run, running, done or failed. */
    state: () => {
      const run = answer();

      if (run === undefined) return "notRun" as const;

      return run.state === "found" ? "done" as const : run.state;
    },
    cause: () => {
      const run = answer();

      return run?.state === "failed" ? run.cause : undefined;
    },
    /** U7700b: the listing's files are no longer the ones the pass read. */
    stale: () => pass()?.answer.state === "found" && pass()?.signature !== input.signature(),
    list,
    totals,
    ask,
    drop,
    /** U7700d: Keep makes the user's own unsent note on the lines, and the finding leaves the list; a full batch leaves it where it was. */
    keep: async (finding: Finding, value: FileComparison) => {
      const range = { side: "new" as const, start: finding.start, end: finding.end };

      if (await input.notes.save(input.id, { comparison: value, ...range, source: sourceAt(value, range) ?? "", text: finding.text, label: finding.label })) drop(finding);
    },
  };
};

export type FindingsState = ReturnType<typeof createFindings>;

const markOf = (finding: Finding): Found => ({ found: true, side: "new", start: finding.start, end: finding.end, finding });

/** U7700c, U7700e: one file's findings as marks Pierre keys by identity, and whether the file's lines changed since the pass read them. */
export const createFinding = (input: { findings: () => FindingsState | undefined; path: () => string; value: () => FileComparison | undefined }) => {
  const marks = createMemo((): readonly Found[] => (input.findings()?.list() ?? []).flatMap(finding => finding.path === input.path() ? [markOf(finding)] : []), { equals: (a, b) => a.length === b.length && a.every((each, at) => each.finding === b[at]?.finding) });

  return {
    marks,
    changed: (finding: Finding) => changedFrom(input.value(), { side: "new", start: finding.start, end: finding.end }, finding.source),
    keep: (finding: Finding) => {
      const value = input.value();

      if (value) void input.findings()?.keep(finding, value);
    },
    drop: (finding: Finding) => input.findings()?.drop(finding),
  };
};

export type FileFindings = ReturnType<typeof createFinding>;
