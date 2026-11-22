import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { CallPaths } from "@contracts/agent/CallPaths";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { LanguageRow } from "@contracts/agent/LanguageRow";
import type { Events } from "../app/events";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import type { Done } from "./flows";
import { createLate } from "./late";
import { WRITING } from "./owned";

/** U7683b: the one language the App never traces by itself: Rust starts only on Trace (the owner's decision 7). */
const MANUAL = "rust";

const TURN_ENDS = ["done", "idle", "error"];

/** U7683f: what a language's trace ended as; a finished one keeps the blob each file it names had when it was asked. */
type Result = { kind: "done"; answer: Done; blobs: ReadonlyMap<string, string | null> } | { kind: "noServer" } | { kind: "failed"; cause: string };

/** U7683f: the line a language shows, with the button it offers, if any. */
export type Line = { language: string; files: number; state: "tracing" | "untraced" | "noServer" | "failed" | "dim"; cause: string | undefined; action: "trace" | "retry" | undefined };

const NO_SERVER: Result = { kind: "noServer" };

type Held = { answer: CallPaths | undefined };

const lineOf = (row: LanguageRow, state: Line["state"], action: Line["action"] = undefined, cause: string | undefined = undefined): Line => ({ language: row.language, files: row.files, state, action, cause });

const resultOf = (answer: CallPaths, seen: ReadonlyMap<string, string | null>): Result => {
  if ("languages" in answer) return { kind: "failed", cause: "unexpected_answer" };

  if (answer.state === "done") return { kind: "done", answer, blobs: new Map(answer.symbols.map(symbol => [symbol.path, seen.get(symbol.path) ?? null])) };

  return answer.state === "noServer" ? { kind: "noServer" } : { kind: "failed", cause: answer.cause.detail };
};

/**
 * U7683b: the call paths of the open comparison. The lookup and each language's trace are `agent.callPaths`: once the listing is ready the lookup asks, every language but Rust traces, and Rust traces on `trace`.
 * A new `to` or `reset` (the merge base moved) ends what ran: its answers are dropped, since the Daemon cannot be stopped, and the lookup asks again. A written file dims the language that names it, and a turn's end traces a dimmed language again once, never Rust.
 */
export const createCallPaths = (input: { app: AppSeam; events: Events; id: string; to: () => "tree" | "branch" | null; files: () => readonly ChangedFile[]; ready: () => boolean }) => {
  const [rows, setRows] = createSignal<readonly LanguageRow[]>([]);
  const [results, setResults] = createSignal<ReadonlyMap<string, Result>>(new Map());
  const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set());
  const [lookup, setLookup] = createSignal<{ failed: string } | undefined>();
  const blobs = createMemo(() => new Map(input.files().map(file => [file.path, file.blob])));
  const late = createLate(() => pending().size > 0 && [...pending()].sort().join());
  let generation = 0;
  let written = false;

  const settle = (language: string, result: Result | undefined) => {
    setPending(before => new Set([...before].filter(each => each !== language)));

    if (result) setResults(before => new Map(before).set(language, result));
  };

  /** One `agent.callPaths` request; its answer counts only while the comparison is the one it was asked for. */
  const ask = async (language: string | undefined) => {
    const to = input.to();
    const mine = generation;
    const seen = blobs();
    const held: Held = { answer: undefined };

    if (!to) return undefined;

    const failure = await failureOf(async () => { held.answer = await input.app.rpc("agent.callPaths", language === undefined ? { id: input.id, to } : { id: input.id, to, language }); });

    return mine === generation ? { failure, answer: held.answer, seen } : undefined;
  };

  const trace = async (language: string) => {
    if (pending().has(language)) return;
    setPending(before => new Set(before).add(language));

    const got = await ask(language);

    if (got) settle(language, got.failure !== null || !got.answer ? { kind: "failed", cause: got.failure ?? "no_answer" } : resultOf(got.answer, got.seen));
  };

  const start = async () => {
    const got = await ask(undefined);

    if (!got) return;

    if (got.failure !== null || !got.answer) return void setLookup({ failed: got.failure ?? "no_answer" });

    if (!("languages" in got.answer)) return void setLookup({ failed: "unexpected_answer" });

    setRows(got.answer.languages);
    setResults(new Map(got.answer.languages.flatMap(row => row.server.found ? [] : [[row.language, NO_SERVER] as const])));

    for (const row of got.answer.languages) if (row.server.found && row.language !== MANUAL) void trace(row.language);
  };

  const clear = () => {
    generation += 1;
    written = false;
    setRows([]);
    setResults(new Map());
    setPending(new Set<string>());
    setLookup(undefined);
  };

  const restart = () => {
    clear();
    void start();
  };

  let current: "tree" | "branch" | null | undefined;
  let begun = false;

  const begin = () => {
    begun = true;
    void start();
  };

  // The lookup asks once for a comparison, when its listing is ready; another `to` is another comparison.
  createEffect(() => ({ ready: input.ready(), to: input.to() }), ({ ready, to }) => {
    if (to !== current) {
      current = to;
      begun = false;
      clear();
    }

    if (ready && to && !begun) begin();
  });

  const dimmed = (language: string) => {
    const result = results().get(language);

    return result?.kind === "done" && [...result.blobs].some(([path, blob]) => blobs().get(path) !== blob);
  };

  const stop = input.events.subscribe(event => {
    if (event.name === "agent.toolCall" && event.data.id === input.id && WRITING.has(event.data.call.tool) && event.data.call.state !== "running") written = true;
    else if (event.name === "agent.status" && event.data.id === input.id && TURN_ENDS.includes(event.data.status.kind)) {
      const wrote = written;

      written = false;

      untrack(() => { for (const [language, result] of results()) if (language !== MANUAL && result.kind === "done" && (wrote || dimmed(language))) void trace(language); });
    }
  });

  onCleanup(stop);

  const lines = createMemo((): Line[] => rows().flatMap((row): Line[] => {
    const result = results().get(row.language);

    if (pending().has(row.language) && late()) return [lineOf(row, "tracing")];

    if (result?.kind === "failed") return [lineOf(row, "failed", "retry", result.cause)];

    if (result?.kind === "noServer") return [lineOf(row, "noServer")];

    if (result === undefined && row.language === MANUAL) return [lineOf(row, "untraced", "trace")];

    return dimmed(row.language) ? [lineOf(row, "dim", row.language === MANUAL ? "trace" : undefined)] : [];
  }));

  /** The finished traces, whose flows the list draws. */
  const done = createMemo(() => [...results().values()].flatMap(result => result.kind === "done" ? [result.answer] : []));

  /** The languages whose finished trace names a file that changed since. */
  const dim = createMemo(() => [...results().entries()].flatMap(([language, result]) => result.kind === "done" && dimmed(language) ? [{ language, answer: result.answer }] : []));

  return {
    lines,
    done,
    dim,
    failed: () => lookup()?.failed,
    trace: (language: string) => void trace(language),
    retry: restart,
    /** The merge base moved and the listing is fresh: what ran is dropped and the lookup asks again. */
    reset: () => {
      clear();
      begun = false;

      if (untrack(input.ready) && untrack(input.to)) begin();
    },
  };
};

export type CallPathsState = ReturnType<typeof createCallPaths>;
