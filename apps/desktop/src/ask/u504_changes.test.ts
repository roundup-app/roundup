import { expect, it } from "vitest";
import type { Event } from "@contracts/Event";
import type { Deliverable } from "@contracts/deliverable/Deliverable";
import { finishedSince } from "./changes";

const actor: Event["actor"] = { kind: "user", id: "you", parent: null };

const record = (id: string): Deliverable => ({ project: "p", id, maker: { kind: "user", id: "you", parent: null }, maker_name: "Me", home: null, title: "same title", published_at: 1, target: { kind: "external", url: `https://example.com/${id}`, availability: "not-checked" } });

const completed = (seq: number, maker: string, turn: string): Event => ({ seq, actor: actor, name: "agent.completed", data: { maker, attempt: "a1", turn } });

const published = (seq: number, id: string, maker: string, turn: string | null): Event => ({ seq, actor: actor, name: "deliverable.published", data: { record: record(id), completion: turn ? { maker, attempt: "a1", turn } : null } });

it("u504_changes_come_from_events_once", () => {
  const events = [
    completed(3, "m", "t0"),
    completed(5, "m", "t1"),
    published(6, "r1", "m", "t1"),
    published(7, "loose", "m", null),
    completed(8, "m", "t2"),
    completed(8, "m", "t2"),
    published(9, "r2", "m", "t2"),
    published(9, "r2", "m", "t2"),
    published(10, "r3", "m", "t2"),
  ];

  const rows = finishedSince(events, 4);

  // Two completions of one Agent are two rows; the boundary drops t0; the replayed pair counts once.
  expect(rows.map(row => [row.key, row.published.map(item => item.id)])).toEqual([["m:a1:t2", ["r2", "r3"]], ["m:a1:t1", ["r1"]]]);
  expect(rows.map(row => row.seq)).toEqual([10, 6]);
  expect(finishedSince(events, 10)).toEqual([]);
});
