import { createEffect, createSignal } from "solid-js";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { FileContent } from "@contracts/agent/FileContent";
import type { OwnedGroupKey } from "@contracts/agent/OwnedGroupKey";
import type { AppSeam } from "../app/seam";
import { compareParams, revisionOf } from "./fileState";
import { createLate } from "./late";
import { readMoves } from "./moveReader";
import { arrived, holds, leftFiles, names, sameBody } from "./moves";
import type { Left, Moved } from "./moves";
import { reply } from "./notes";
import type { Entry } from "./symbols";
import type { Span } from "./repeats";

/** The most pairs of files a listing reads to find code that left one file for another. */
const MAX_PAIRS = 20;

type Read = { revision: string } & ({ state: "reading" } | { state: "done"; moved: readonly Moved[] } | { state: "failed"; cause: string });

const textOf = (side: FileContent) => side.kind === "text" ? side.text : side.kind === "absent" ? "" : undefined;

/**
 * U7696a, U7696c, U7696d: what the Logic lens knows of moved and renamed code. A file the reader draws is read once for each revision, in the move Worker, and its marks stay while that revision does; a reply for an older revision is dropped. The functions and types the call paths name as removed from one file and added to another are matched by name and kind, and their bodies read once from the two files.
 * A new comparison target drops every answer; leaving `on` (the Logic lens) keeps them. The marks of a file are known once it has been drawn, so a mark of code that left another file waits for that file's read too.
 */
export const createMoves = (input: { app: AppSeam; id: string; to: () => CompareTarget; group: () => OwnedGroupKey | undefined; on: () => boolean; symbols: () => readonly ChangedSymbol[] }) => {
  const [reads, setReads] = createSignal<ReadonlyMap<string, Read>>(new Map());
  const [crossed, setCrossed] = createSignal<readonly Left[]>([]);
  const [crossFailure, setCrossFailure] = createSignal<string | null>(null);
  const requests = new Map<string, { revision: string; text: { path: string; old: string; new: string } }>();
  const seen = new Map<string, FileComparison>();
  const marks = new Map<Left, Moved>();
  let generation = 0;

  const pending = () => [...reads().values()].some(read => read.state === "reading");
  const late = createLate(pending);

  const put = (path: string, read: Read) => setReads(old => new Map(old).set(path, read));

  const start = (path: string, revision: string, text: { path: string; old: string; new: string }) => {
    const mine = generation;
    const settle = (read: Read) => { if (mine === generation && requests.get(path)?.revision === revision) put(path, read); };

    put(path, { revision, state: "reading" });
    requests.set(path, { revision, text });
    readMoves(text).then(moved => settle({ revision, state: "done", moved }), (error: Error) => settle({ revision, state: "failed", cause: error.message }));
  };

  /** A file the diff has drawn: asked once for each revision. */
  const request = (value: FileComparison) => {
    if (!input.on()) return;
    const revision = revisionOf(value);
    const [old, next] = [textOf(value.old), textOf(value.new)];

    seen.set(value.newPath, value);

    if (old === undefined || next === undefined || requests.get(value.newPath)?.revision === revision) return;
    start(value.newPath, revision, { path: value.newPath, old, new: next });
  };

  const fetched = async (path: string) => {
    const kept = seen.get(path);

    if (kept) return kept;
    const result = await reply(() => input.app.rpc("agent.compareFile", compareParams(input.id, path, input.to(), input.group())));

    if (result.kind !== "ok") throw new Error(result.text);
    seen.set(path, result.value);

    return result.value;
  };

  const check = async (pairs: readonly Left[]) => {
    const mine = generation;
    const found: Left[] = [];

    try {
      for (const pair of pairs.slice(0, MAX_PAIRS)) {
        const [gone, came] = await Promise.all([fetched(pair.from.path), fetched(pair.to.path)]);

        if (mine !== generation) return;

        if (gone.old.kind === "text" && came.new.kind === "text" && sameBody(gone.old.text, pair.from.old, came.new.text, pair.to.new)) found.push(pair);
      }

      setCrossFailure(null);
      setCrossed(found);
    } catch (error) {
      if (mine === generation) setCrossFailure(error instanceof Error ? error.message : String(error));
    }
  };

  // A new comparison target starts over; leaving the Logic lens keeps what was read.
  createEffect(() => [input.to(), input.group() ?? ""].join("|"), () => {
    generation += 1;
    requests.clear();
    seen.clear();
    setReads(new Map());
    setCrossed([]);
    setCrossFailure(null);
  });

  createEffect(() => ({ on: input.on(), pairs: input.on() ? leftFiles(input.symbols()) : [] }), ({ on, pairs }) => { if (on && pairs.length > 0) void check(pairs); });

  /** The mark of a confirmed pair stays the same object while the pair does, so the diff does not draw it again. */
  const markOf = (pair: Left) => marks.get(pair) ?? marks.set(pair, arrived(pair)).get(pair) ?? arrived(pair);

  const readOf = (path: string) => { const read = reads().get(path);

 return read?.state === "done" ? read.moved : []; };

  const of = (path: string): readonly Moved[] => [...readOf(path), ...crossed().filter(pair => pair.to.path === path).map(markOf)];

  const all = () => [...new Set([...reads().keys(), ...crossed().map(pair => pair.to.path)])].flatMap(path => of(path).map(moved => ({ path, moved })));

  const failures = () => [...reads().values()].flatMap(read => read.state === "failed" ? [read.cause] : []).concat(crossFailure() ?? []);

  return {
    request,
    of,
    /** U7696c: where each mark begins and ends, for the row counts. */
    placed: (): readonly Span[] => all().flatMap(({ path, moved }) => moved.lines[0] ? [{ path, start: moved.lines[0].start, end: moved.lines[0].end }] : []),
    /** U7696e: every new-side line of a repeat is inside one move of its file. */
    covers: (span: Span) => of(span.path).some(moved => Array.from({ length: span.end - span.start + 1 }, (_, at) => span.start + at).every(line => holds(moved, line))),
    /** U7696f: the word a changed function or type of the list carries when its lines moved or were renamed. */
    label: (entry: Entry): Moved["kind"] | undefined => {
      const left = crossed().find(pair => entry.side === "old" ? pair.from.path === entry.path && pair.from.old.start === entry.span.start : pair.to.path === entry.path && pair.to.new.start === entry.span.start);

      return left ? "moved" : entry.side === "new" ? of(entry.path).find(moved => names(moved, entry.span))?.kind : undefined;
    },
    scanning: () => pending() && late(),
    failed: (): string | null => failures()[0] ?? null,
    /** The failed reads asked again. */
    again: () => {
      for (const [path, read] of reads()) {
        const asked = read.state === "failed" ? requests.get(path) : undefined;

        if (asked) start(path, asked.revision, asked.text);
      }

      if (crossFailure() !== null) void check(leftFiles(input.symbols()));
    },
  };
};

export type Moves = ReturnType<typeof createMoves>;
