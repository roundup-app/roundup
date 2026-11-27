import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { OwnedGroupKey } from "@contracts/agent/OwnedGroupKey";
import type { Spot } from "@contracts/agent/Spot";
import type { Events } from "../app/events";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import { copy } from "./copy";
import type { Spotted } from "./diffDraw";
import type { Grouped, Takes } from "./modules";
import type { Moved } from "./moves";
import { apart } from "./moves";
import { watchTurns } from "./owned";
import { placeCounts, shownSpan } from "./repeats";

const NONE: readonly Spot[] = [];

type ToolSpot = Spot & { source: { kind: "tool"; name: string } };

const isTool = (spot: Spot): spot is ToolSpot => spot.source.kind === "tool";

/** U7704a: the words a spot's source goes by: the repeat scan's own, or the tool's name. */
export const sourceLabel = (spot: Spot) => spot.source.kind === "tool" ? spot.source.name : copy.repeats;

/** U7704a, U7685a: a spot marks the lines a file shows of it, `only` naming the hunks that file draws; a repeat gives way to a move of its lines (U7696e), a tool's spot never does. The objects stay while the spots do, so a mark and its open excerpt are not drawn again. */
export const createSpotted = (spots: () => readonly Spot[] | undefined, only: () => Takes | undefined, moves: () => readonly Moved[]) => {
  const apartOnly = createMemo(() => apart(only(), moves()));

  return createMemo((): readonly Spotted[] => (spots() ?? []).flatMap(spot => {
    const span = shownSpan(spot, spot.source.kind === "repeats" ? apartOnly() : only());

    return span ? [{ spotting: true as const, side: "new" as const, ...span, spot }] : [];
  }), { equals: (a, b) => a.length === b.length && a.every((each, at) => each.spot === b[at]?.spot && each.start === b[at]?.start && each.end === b[at]?.end) });
};

/** U7704e: the lines a read holds on its new side. */
const newLines = (read: FileComparison) => read.new.kind === "text" ? read.new.text.replace(/\n$/, "").split("\n").length : 0;

/** U7704e: the spots of `read`'s file that no line of its diff can carry: all of them when it draws no lines, else those that end past its last line (a fold hides the others, and the diff opens it, U7692b). A section draws only its own hunks (`only`), so only a whole file lists them. */
export const undrawn = (spots: readonly Spot[], read: FileComparison | undefined, drawable: boolean, only: Takes | undefined) => read === undefined || only ? NONE : spots.filter(spot => spot.path === read.newPath && (!drawable || spot.end > newLines(read)));

/** U7704c: for each item of `grouped` by its name, the tool spots its files hold, one entry for each source: "3 from oxlint". */
export const sourceCounts = (grouped: Grouped, spots: readonly Spot[]): ReadonlyMap<string, readonly (readonly [string, number])[]> => {
  const tools = spots.filter(isTool);
  const counts = new Map<string, (readonly [string, number])[]>();

  for (const name of new Set(tools.map(spot => spot.source.name))) {
    for (const [item, count] of placeCounts(grouped, tools.filter(spot => spot.source.name === name))) counts.set(item, [...counts.get(item) ?? [], [name, count]]);
  }

  return counts;
};

/**
 * U7704b, U7704d: the spots tools posted, read with `agent.spots` once `on` and `ready` hold, again when `again` is called, when the open group changes and whenever the Agent's turn ends; the last answer stays until the next lands.
 * Leaving `on` drops the answer, and a read that lands after a newer one was asked is dropped.
 */
export const createSpots = (input: { app: AppSeam; events: Events; id: string; on: () => boolean; ready: () => boolean; group: () => OwnedGroupKey | undefined }) => {
  const [answer, setAnswer] = createSignal<readonly Spot[]>();
  const [failed, setFailed] = createSignal<string | null>(null);
  let generation = 0;
  let begun = false;

  const ask = async () => {
    const mine = ++generation;
    const group = input.group();
    let spots: readonly Spot[] = NONE;
    const failure = await failureOf(async () => { spots = (await input.app.rpc("agent.spots", group ? { id: input.id, group } : { id: input.id })).spots; });

    if (mine !== generation) return;
    setAnswer(failure === null ? spots : undefined);
    setFailed(failure);
  };

  createEffect(() => ({ on: input.on(), ready: input.ready(), group: input.group() }), ({ on, ready }) => {
    if (!on) {
      generation += 1;
      begun = false;
      setAnswer(undefined);
      setFailed(null);
    } else if (ready) {
      begun = true;
      void ask();
    }
  });

  onCleanup(watchTurns(input.events, input.id, { wrote: () => undefined, ended: () => { if (begun) void ask(); } }));

  return {
    list: (): readonly Spot[] => answer() ?? NONE,
    failed,
    again: () => { if (begun) void ask(); },
  };
};

export type SpotsRead = ReturnType<typeof createSpots>;
