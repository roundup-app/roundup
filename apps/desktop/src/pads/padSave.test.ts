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
  ["a reply for the sent version cleans", { kind: "sending", text: "a", version: 2 }, { kind: "applied", version: 2 }, { kind: "clean" }],
  ["a refusal keeps the draft dirty", { kind: "sending", text: "a", version: 2 }, { kind: "refused" }, { kind: "dirty", due: null }],
  ["an unknown reply pauses", { kind: "sending", text: "a", version: 2 }, { kind: "unknown" }, { kind: "paused" }],
  ["an outside change is a conflict", { kind: "dirty", due: null }, { kind: "external", actor: alice, version: 3 }, { kind: "conflict", actor: alice, version: 3 }],
  ["Resume asks for a write", { kind: "paused" }, { kind: "resume" }, { kind: "dirty", due: "autosave" }],
  ["choosing theirs cleans a conflict", { kind: "conflict", actor: "unknown", version: 3 }, { kind: "settled" }, { kind: "clean" }],
  ["an unchanged due write is skipped", { kind: "dirty", due: "autosave" }, { kind: "skipped" }, { kind: "dirty", due: null }],
  ["a removal is deleted", { kind: "dirty", due: null }, { kind: "gone", byMe: false }, { kind: "deleted", byMe: false }],
  ["my own removal stays mine", { kind: "deleted", byMe: false }, { kind: "gone", byMe: true }, { kind: "deleted", byMe: true }],
  ["a deleted pad ignores edits", { kind: "deleted", byMe: false }, { kind: "edited" }, { kind: "deleted", byMe: false }],
  ["an undone delete is clean", { kind: "deleted", byMe: true }, { kind: "back" }, { kind: "clean" }],
];

it.each(rows)("u2773b_pad_save_step_transitions: %s", (_name, from, event, to) => {
  expect(step(from, event)).toEqual(to);
});

it("u2773b_an_older_reply_never_consumes_a_newer_revision", () => {
  const sending = step({ kind: "dirty", due: "autosave" }, { kind: "send", text: "a", version: 0, mine: false });
  const conflicted = step(sending, { kind: "external", actor: alice, version: 1 });

  expect(step(conflicted, { kind: "applied", version: 0 })).toEqual({ kind: "conflict", actor: alice, version: 1 });
  expect(step({ kind: "clean" }, { kind: "applied", version: 0 })).toEqual({ kind: "clean" });
});
