import type { Event } from "@contracts/Event";
import type { Deliverable } from "@contracts/deliverable/Deliverable";

/** U504: one Agent or Workstream completion after the last-visit boundary, with what that turn published. */
export type Finished = {
  kind: "finished";
  /** `maker:attempt:turn`, the identity of the completed turn. */
  key: string;
  maker: string;
  /** The Event number of the newest event describing this completion. */
  seq: number;
  /** Publications recorded for this turn, oldest first by Event order. */
  published: Deliverable[];
};

/**
 * U504: historical change rows come from saved Events strictly after `boundary`, never from the current
 * catalogues. The Event number orders and deduplicates: a replayed or repeated notification adds nothing,
 * and two completions of one Agent stay two rows. A publication with no recorded completion belongs to
 * no row. Newest first.
 */
export const finishedSince = (events: readonly Event[], boundary: number): Finished[] => {
  const rows = new Map<string, Finished>();
  const counted = new Set<number>();

  for (const event of [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    const seq = event.seq;

    if (seq === undefined || seq <= boundary || counted.has(seq)) continue;
    counted.add(seq);

    if (event.name !== "agent.completed" && event.name !== "deliverable.published") continue;
    const completion = event.name === "agent.completed" ? event.data : event.data.completion;

    if (!completion) continue;
    const key = `${completion.maker}:${completion.attempt}:${completion.turn}`;
    const row = rows.get(key) ?? { kind: "finished", key, maker: completion.maker, seq, published: [] };

    row.seq = seq;

    if (event.name === "deliverable.published" && !row.published.some(record => record.id === event.data.record.id)) row.published.push(event.data.record);
    rows.set(key, row);
  }

  return [...rows.values()].sort((a, b) => b.seq - a.seq);
};
