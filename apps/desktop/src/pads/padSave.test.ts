import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import { step } from "./padSave";
import type { Save, SaveEvent } from "./padSave";

const alice: Actor = { kind: "user", id: "u", parent: null };

const rows: [string, Save, SaveEvent, Save][] = [
  ["typing makes clean dirty", { kind: "clean" }, { kind: "edited" }, { kind: "dirty", due: null }],
  ["typing keeps a Keep mine due", { kind: "dirty", due: "keep-mine" }, { kind: "edited" }, { kind: "dirty", due: "keep-mine" }],
  ["typing cancels an autosave due", { kind: "dirty", due: "autosave" }, { kind: "edited" }, { kind: "dirty", due: null }],
  ["typing leaves a conflict", { kind: "conflict", actor: alice, version: 1 }, { kind: "edited" }, { kind: "conflict", actor: alice, version: 1 }],
  ["blur on clean sends nothing", { kind: "clean" }, { kind: "due", due: "autosave" }, { kind: "clean" }],
  ["blur on dirty is due", { kind: "dirty", due: null }, { kind: "due", due: "autosave" }, { kind: "dirty", due: "autosave" }],
  ["blur leaves a pause", { kind: "paused" }, { kind: "due", due: "autosave" }, { kind: "paused" }],
  ["Keep mine leaves a pause", { kind: "paused" }, { kind: "due", due: "keep-mine" }, { kind: "dirty", due: "keep-mine" }],
  ["Keep mine keeps the conflict until it sends", { kind: "conflict", actor: alice, version: 2 }, { kind: "due", due: "keep-mine" }, { kind: "conflict", actor: alice, version: 2 }],
  ["a due write sends", { kind: "dirty", due: "autosave" }, { kind: "send", text: "a", version: 0, mine: false }, { kind: "sending", text: "a", version: 0 }],
  ["a conflict sends only for Keep mine", { kind: "conflict", actor: alice, version: 2 }, { kind: "send", text: "a", version: 2, mine: false }, { kind: "conflict", actor: alice, version: 2 }],
  ["Keep mine sends from a conflict", { kind: "conflict", actor: alice, version: 2 }, { kind: "send", text: "a", version: 2, mine: true }, { kind: "sending", text: "a", version: 2, over: alice }],
  ["an autosave asked for in flight waits for the reply", { kind: "sending", text: "a", version: 2 }, { kind: "due", due: "autosave" }, { kind: "sending", text: "a", version: 2, due: "autosave" }],
  ["an autosave asked for in flight writes after the reply", { kind: "sending", text: "a", version: 2, due: "autosave" }, { kind: "applied", version: 2, current: false }, { kind: "dirty", due: "autosave" }],
  ["a reply alone never asks for another write", { kind: "sending", text: "a", version: 2 }, { kind: "applied", version: 2, current: false }, { kind: "dirty", due: null }],
  ["an autosave asked for in flight never writes over a newer change", { kind: "sending", text: "a", version: 2, over: alice, due: "autosave" }, { kind: "applied", version: 1, current: false }, { kind: "conflict", actor: alice, version: 2 }],
  ["a reply for the sent version cleans", { kind: "sending", text: "a", version: 2 }, { kind: "applied", version: 2, current: true }, { kind: "clean" }],
  ["a refusal keeps the draft dirty", { kind: "sending", text: "a", version: 2 }, { kind: "refused" }, { kind: "dirty", due: null }],
  ["a refusal keeps a shown conflict", { kind: "sending", text: "a", version: 2, over: alice }, { kind: "refused" }, { kind: "conflict", actor: alice, version: 2 }],
  ["an outside change during a write waits for its reply", { kind: "sending", text: "a", version: 0 }, { kind: "external", actor: alice, version: 1 }, { kind: "sending", text: "a", version: 1, over: alice }],
  ["Keep mine during a write follows its reply", { kind: "sending", text: "a", version: 1, over: alice }, { kind: "due", due: "keep-mine" }, { kind: "sending", text: "a", version: 1, over: alice, due: "keep-mine" }],
  ["Keep mine needs a shown conflict", { kind: "sending", text: "a", version: 0 }, { kind: "due", due: "keep-mine" }, { kind: "sending", text: "a", version: 0 }],
  ["an older reply under Keep mine writes again", { kind: "sending", text: "a", version: 1, over: alice, due: "keep-mine" }, { kind: "applied", version: 0, current: false }, { kind: "dirty", due: "keep-mine" }],
  ["an unknown reply pauses", { kind: "sending", text: "a", version: 2 }, { kind: "unknown" }, { kind: "paused" }],
  ["an outside change is a conflict", { kind: "dirty", due: null }, { kind: "external", actor: alice, version: 3 }, { kind: "conflict", actor: alice, version: 3 }],
  ["Resume asks for a write", { kind: "paused" }, { kind: "resume" }, { kind: "dirty", due: "autosave" }],
  ["choosing theirs cleans a conflict", { kind: "conflict", actor: "unknown", version: 3 }, { kind: "settled" }, { kind: "clean" }],
  ["an unchanged due write is skipped", { kind: "dirty", due: "autosave" }, { kind: "skipped" }, { kind: "dirty", due: null }],
  ["a removal is deleted", { kind: "dirty", due: null }, { kind: "gone", byMe: false }, { kind: "deleted", byMe: false }],
  ["my own removal stays mine", { kind: "deleted", byMe: false }, { kind: "gone", byMe: true }, { kind: "deleted", byMe: true }],
  ["a deleted pad ignores edits", { kind: "deleted", byMe: false }, { kind: "edited" }, { kind: "deleted", byMe: false }],
  ["an undone delete is clean", { kind: "deleted", byMe: true }, { kind: "back" }, { kind: "clean" }],
  ["an undone delete keeps an unseen outside edit a conflict", { kind: "deleted", byMe: false }, { kind: "back", unseen: { actor: "unknown", version: 1 } }, { kind: "conflict", actor: "unknown", version: 1 }],
];

it.each(rows)("u2773b_pad_save_step_transitions: %s", (_name, from, event, to) => {
  expect(step(from, event)).toEqual(to);
});

it("u2773b_an_older_reply_never_consumes_a_newer_revision", () => {
  const sending = step({ kind: "dirty", due: "autosave" }, { kind: "send", text: "a", version: 0, mine: false });
  const conflicted = step(sending, { kind: "external", actor: alice, version: 1 });

  expect(step(conflicted, { kind: "applied", version: 0, current: false })).toEqual({ kind: "conflict", actor: alice, version: 1 });
  expect(step({ kind: "clean" }, { kind: "applied", version: 0, current: false })).toEqual({ kind: "clean" });
});

// P7547b: the model's records, whose absent fields hold a default; `Actor` is "agent" for any one, as in padSave.tla.
type SaveRecord = { byMe: boolean; due: string; kind: string; over: string; version: number };

type ModelEvent = { actor: string; byMe: boolean; current: boolean; due: string; kind: string; mine: boolean; version: number };

const actorOf = (actor: string): Actor | "unknown" => actor === "unknown" ? "unknown" : alice;

const nameOf = (actor: Actor | "unknown" | undefined) => actor === undefined ? "none" : actor === "unknown" ? "unknown" : "agent";

// Keys in the order TLC's dump writes them (sorted), so one `JSON.stringify` names a record.
const recordOf = (save: Save): SaveRecord => ({
  byMe: save.kind === "deleted" ? save.byMe : false,
  due: "due" in save ? save.due ?? "none" : "none",
  kind: save.kind,
  over: save.kind === "sending" ? nameOf(save.over) : save.kind === "conflict" ? nameOf(save.actor) : "none",
  version: save.kind === "sending" || save.kind === "conflict" ? save.version : 0,
});

const eventOf = (event: ModelEvent): SaveEvent => {
  switch (event.kind) {
    case "due": return { kind: "due", due: event.due === "keep-mine" ? "keep-mine" : "autosave" };
    case "send": return { kind: "send", text: "a", version: event.version, mine: event.mine };
    case "applied": return { kind: "applied", version: event.version, current: event.current };
    case "external": return { kind: "external", actor: actorOf(event.actor), version: event.version };
    case "gone": return { kind: "gone", byMe: event.byMe };
    case "back": return event.actor === "none" ? { kind: "back" } : { kind: "back", unseen: { actor: actorOf(event.actor), version: event.version } };
    case "skipped": return { kind: "skipped" };
    case "resume": return { kind: "resume" };
    case "edited": return { kind: "edited" };
    case "refused": return { kind: "refused" };
    case "unknown": return { kind: "unknown" };
    default: return { kind: "settled" };
  }
};

const ev = (kind: string, rest: Partial<ModelEvent> = {}): ModelEvent => ({ actor: "none", byMe: false, current: false, due: "none", kind, mine: false, version: 0, ...rest });

type World = { save: Save; flight: { on: boolean; v: number; lands: boolean }; ver: number; writes: number; stale: boolean };

/** The model's Daemon and other Agents: a write lands or is refused or lost, and one outside edit comes (bound: MaxExternal 1, MaxWrites 2, padSave.cfg). */
const moves = (world: World): [ModelEvent, (next: Save) => World][] => {
  const { save, flight, ver, writes, stale } = world;
  const keep = (next: Save): World => ({ ...world, save: next });
  const out: [ModelEvent, (next: Save) => World][] = [];

  for (const kind of ["edited", "skipped", "resume"]) out.push([ev(kind), keep]);

  for (const due of ["autosave", "keep-mine"]) out.push([ev("due", { due }), keep]);

  for (const byMe of [false, true]) out.push([ev("gone", { byMe }), keep]);

  for (const actor of ["none", "unknown"]) if ((actor !== "none") === stale) out.push([ev("back", { actor, version: actor === "none" ? 0 : ver }), keep]);

  out.push([ev("settled"), next => ({ ...world, save: next, stale: false })]);

  if (!flight.on) {
    for (const mine of [false, true]) {
      const version = save.kind === "conflict" ? save.version : ver;

      for (const lands of [false, true]) {
        if (lands && !mine && stale) continue;

        out.push([ev("send", { version, mine }), next => ({ ...world, save: next, flight: save.kind !== "sending" && next.kind === "sending" ? { on: true, v: version, lands } : flight })]);
      }
    }
  }

  if (flight.on && flight.lands && writes < 2) {
    for (const current of [false, true]) out.push([ev("applied", { version: flight.v, current }), next => ({ save: next, flight: { on: false, v: 0, lands: false }, ver, writes: writes + 1, stale: flight.v === ver ? false : stale })]);
  }

  if (flight.on && !flight.lands) out.push([ev("refused"), next => ({ ...world, save: next, flight: { on: false, v: 0, lands: false } })]);

  if (flight.on) out.push([ev("unknown"), next => ({ ...world, save: next, flight: { on: false, v: 0, lands: false } })]);

  if (ver < 1 && save.kind !== "clean" && save.kind !== "deleted") {
    for (const actor of ["agent", "unknown"]) out.push([ev("external", { actor, version: ver + 1 }), next => ({ ...world, save: next, ver: ver + 1, stale: true })]);
  }

  return out;
};

it("p7547b_step_reaches_what_the_model_reaches", () => {
  const key = (record: SaveRecord) => JSON.stringify(record);
  const dump = readFileSync("src/pads/padSave.dump", "utf8").trim().split("\n");
  const line = (prefix: string) => dump.filter(entry => entry.startsWith(`${prefix} `)).map(entry => entry.slice(prefix.length + 1));
  const expectedSaves = new Set(line("save").map(entry => JSON.stringify(JSON.parse(entry))));
  const expectedSteps = new Set(line("step").map(entry => JSON.stringify(JSON.parse(entry))));

  const start: World = { save: { kind: "clean" }, flight: { on: false, v: 0, lands: false }, ver: 0, writes: 0, stale: false };
  const seen = new Set<string>();
  const saves = new Set<string>([key(recordOf(start.save))]);
  const steps = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const world = queue.pop();

    if (!world) break;

    const id = JSON.stringify(world);

    if (seen.has(id)) continue;

    seen.add(id);

    for (const [event, advance] of moves(world)) {
      const next = step(world.save, eventOf(event));
      saves.add(key(recordOf(next)));
      steps.add(JSON.stringify([recordOf(world.save), event, recordOf(next)]));
      queue.push(advance(next));
    }
  }

  expect([...saves].filter(entry => !expectedSaves.has(entry))).toEqual([]);
  expect([...expectedSaves].filter(entry => !saves.has(entry))).toEqual([]);
  expect([...steps].filter(entry => !expectedSteps.has(entry))).toEqual([]);
  expect([...expectedSteps].filter(entry => !steps.has(entry))).toEqual([]);
});
