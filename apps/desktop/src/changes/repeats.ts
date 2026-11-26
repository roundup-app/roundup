import PQueue from "p-queue";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { Gap } from "@contracts/agent/Gap";
import type { ScanHit } from "@contracts/agent/ScanHit";
import type { ScanHits } from "@contracts/agent/ScanHits";
import type { Events } from "../app/events";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import type { Gapped, Movement, Repeated } from "./diffDraw";
import { createLate } from "./late";
import type { Grouped, ModuleGroup, Takes } from "./modules";
import { labelLine } from "./moves";
import type { Moved } from "./moves";
import { reachKey, watchTurns, type Reach } from "./owned";

const NONE: readonly ScanHit[] = [];

/** U7685d: the browser has painted a frame: the next frame's callback runs before the paint, so the task after it runs after. */
const afterPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve)));

/** A place in a file's new side: the lines `start` to `end` of `path`. */
export type Span = { path: string; start: number; end: number };

/** U7685a, U7688e: the lines of `hit` a section that draws only the hunks `takes` shows, first to last; a whole file shows all of them, and none is undefined. */
export const shownSpan = (hit: Pick<Span, "start" | "end">, takes: Takes | undefined): { start: number; end: number } | undefined => {
  if (!takes) return { start: hit.start, end: hit.end };
  const lines = Array.from({ length: hit.end - hit.start + 1 }, (_, at) => hit.start + at).filter(line => takes("new", line));

  return lines.length > 0 ? { start: lines[0] ?? hit.start, end: lines.at(-1) ?? hit.end } : undefined;
};

/** U7685a: a repeat marks the lines a file shows of it; the objects stay while the hits do, so a mark and its open excerpt are not drawn again. */
export const createRepeated = (hits: () => readonly ScanHit[] | undefined, only: () => Takes | undefined) => createMemo((): readonly Repeated[] => (hits() ?? []).flatMap(hit => {
  const span = shownSpan(hit, only());

  return span ? [{ repeating: true as const, side: "new" as const, ...span, hit }] : [];
}), { equals: (a, b) => a.length === b.length && a.every((each, at) => each.hit === b[at]?.hit && each.start === b[at]?.start && each.end === b[at]?.end) });

/** U7688e: a gap marks the line it names when a file shows it; the objects stay while the gaps do, so a mark is not drawn again. */
export const createGapped = (gaps: () => readonly Gap[] | undefined, only: () => Takes | undefined) => createMemo((): readonly Gapped[] => (gaps() ?? []).flatMap(gap => {
  const span = shownSpan({ start: gap.line, end: gap.line }, only());

  return span ? [{ gapped: true as const, side: "new" as const, ...span, gap }] : [];
}), { equals: (a, b) => a.length === b.length && a.every((each, at) => each.gap === b[at]?.gap) });

/** U7696a: a move marks the lines a file shows of its first range, to the line that names its other place; the objects stay while the moves do, so a mark is not drawn again; nothing here reads a file, the Worker does. */
export const createMoving = (moves: () => readonly Moved[] | undefined, only: () => Takes | undefined) => createMemo((): readonly Movement[] => (moves() ?? []).flatMap(moved => {
  const span = moved.lines[0] && shownSpan(moved.lines[0], only());

  return span ? [{ moving: true as const, side: "new" as const, start: span.start, end: Math.max(span.start, Math.min(span.end, labelLine(moved))), moved }] : [];
}), { equals: (a, b) => a.length === b.length && a.every((each, at) => each.moved === b[at]?.moved) });

const itemHolds = (item: ModuleGroup, span: Span) => item.sections
  ? item.sections.some(section => section.file.path === span.path && shownSpan(span, section.pick) !== undefined)
  : item.files.some(file => file.path === span.path);

/** U7685c, U7688e: for each item of `grouped` by its name, the places (repeats, gaps) whose lines it holds; an item with none is left out. */
export const placeCounts = (grouped: Grouped, spans: readonly Span[]): ReadonlyMap<string, number> =>
  new Map(grouped.modules.flatMap(item => { const count = spans.filter(span => itemHolds(item, span)).length;

    return count > 0 ? [[item.name, count] as const] : []; }));

/**
 * U7685d, U7685e, U7685f: the repeat scan of the working tree: the Tree target or the open Changes group. `agent.repeatScan` is asked once `on` and `ready` hold and a frame has painted, again when `again` is called and when a turn that wrote ends, and one at a time: a call made while one runs waits for it.
 * The answer before stays until the next lands. Leaving `on` drops the answer and what is running.
 */
export const createRepeatScan = (input: { app: AppSeam; events: Events; id: string; on: () => Reach | null; ready: () => boolean }) => {
  const [answer, setAnswer] = createSignal<ScanHits>();
  const [failed, setFailed] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(false);
  const late = createLate(running);
  let generation = 0;
  let wrote = false;
  let begun = false;
  const queue = new PQueue({ concurrency: 1 });

  type Reply = { hits?: ScanHits };

  const scan = async () => {
    const mine = generation;
    const reply: Reply = {};

    setRunning(true);
    await afterPaint();

    const at = untrack(input.on);

    if (!at) return void setRunning(false);

    const failure = await failureOf(async () => { reply.hits = await input.app.rpc("agent.repeatScan", { id: input.id, ...at }); });

    if (mine === generation) {
      setAnswer(failure === null ? reply.hits : undefined);
      setFailed(failure === null ? null : failure);
    }

    setRunning(queue.size > 0);
  };

  /** One scan runs at a time and one waits behind it, however many ask meanwhile. */
  const run = () => { if (queue.size === 0) void queue.add(scan); };

  createEffect(() => ({ on: reachKey(input.on()), ready: input.ready() }), ({ on, ready }) => {
    if (!on) {
      generation += 1;
      begun = false;
      queue.clear();
      setAnswer(undefined);
      setFailed(null);
      setRunning(false);
    } else if (ready && !begun) {
      begun = true;
      run();
    }
  });

  onCleanup(watchTurns(input.events, input.id, {
    wrote: () => { wrote = true; },
    ended: () => { if (wrote && begun) run(); wrote = false; },
  }));

  return {
    hits: (): readonly ScanHit[] => answer()?.hits ?? NONE,
    scanning: () => running() && late(),
    partial: () => answer()?.complete === false,
    failed,
    /** The comparison changed under the marks: ask once more. */
    again: () => { if (begun) run(); },
  };
};

export type RepeatScan = ReturnType<typeof createRepeatScan>;
