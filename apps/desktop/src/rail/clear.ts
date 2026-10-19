import type { ConnectedProject } from "../state/connectedProject";
import * as v from "valibot";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Events } from "../app/events";
import { INTERNAL_CODE, RpcError } from "../app/seam";
import type { AppSeam } from "../app/seam";

import type { draftStorage } from "../state/storage";
import { draftsOf } from "./persist/storage";

type Drafts = ReturnType<typeof draftStorage>;

type Draft = ReturnType<Drafts["list"]>[number];

const NOT_ACKED = -32008;

export type ClearPhase = "closed" | "asking" | "pending";

export type Clearing = {
  phase: Accessor<ClearPhase>;
  /** `✕ <message>` of the last failed clear, with the code that decides the second word. */
  failure: Accessor<{ message: string; code: number | null } | null>;
  reason: Accessor<string>;
  setReason(text: string, selection?: Draft["selection"]): void;
  selection: Accessor<Draft["selection"]>;
  select(selection: Draft["selection"]): void;
  open(): void;
  keep(): void;
  /** One `workstream.clear` with the trimmed reason; none while the reason is empty or a clear is pending. */
  submit(withoutHandoff: boolean): Promise<void>;
  /** The reason a clear gave for each Iteration it began, for the rule above it. */
  reasonFor(iteration: number): string | null;
  offersWithoutHandoff(): boolean;
  canSubmit(): boolean;
};

/** U350: the reason prompt of one Workstream. */
const createClearing = (app: AppSeam, events: Events, id: string, storage: ConnectedProject["drafts"]): Clearing => {
  const [phase, setPhase] = createSignal<ClearPhase>("closed");
  const [failure, setFailure] = createSignal<{ message: string; code: number | null } | null>(null);
  const drafts = draftsOf(storage);
  const destination = { surface: "rail-clear", object: id, recipient: id };
  const current = () => drafts.records().filter((draft) => draft.destination.surface === destination.surface && draft.destination.object === id).at(-1);

  const reason = () => {
    const value = current()?.value.text;

    return v.is(v.string(), value) ? value : "";
  };

  const setReason = (text: string, selection: Draft["selection"] = current()?.selection ?? null) => drafts.edit(destination, { text, withoutHandoff: current()?.value.withoutHandoff ?? false }, selection, "ordinary");
  const canSubmit = () => phase() === "asking" && reason().trim() !== "" && (current()?.status === "draft" || current()?.status === "failed");
  let submitted: Draft | null = null;
  const [reasons, setReasons] = createSignal<ReadonlyMap<number, string>>(new Map());
  let asked = "";

  events.subscribe((event) => {
    if (event.name === "workstream.cleared" && event.data.id === id) {
      setReasons((now) => new Map(now).set(event.data.iteration, asked));
      setPhase("closed");
      setFailure(null);

      if (submitted) drafts.settle(submitted.revision, "acknowledged");
      submitted = null;
    } else if (event.name === "workstream.clearFailed" && event.data.id === id) {
      if (submitted) drafts.settle(submitted.revision, "failed");
      submitted = null;
      setPhase("asking");
      setFailure({ message: event.data.message, code: event.data.code });
    }
  });

  return {
    phase,
    failure,
    reason,
    setReason,
    selection: () => current()?.selection ?? null,
    select: (selection) => { if (current()?.status === "draft") setReason(reason(), selection); },
    open: () => {
      if (phase() === "closed") setPhase("asking");
    },
    keep: () => {
      if (phase() === "pending") return;

      setPhase("closed");
      setFailure(null);

    },
    submit: async (withoutHandoff) => {
      const trimmed = reason().trim();

      if (!canSubmit()) return;

      let snapshot = current();

      if (!snapshot || snapshot.status === "unknown" || snapshot.status === "pending") return;

      if (snapshot.value.withoutHandoff !== withoutHandoff) {
        snapshot = drafts.edit(destination, { ...snapshot.value, withoutHandoff }, snapshot.selection, "ordinary");
      }

      submitted = drafts.submit(snapshot.revision);

      if (!submitted) return;
      const revision = submitted.revision;
      asked = trimmed;
      setPhase("pending");
      setFailure(null);

      try {
        await app.rpc("workstream.clear", withoutHandoff ? { id, reason: trimmed, without_handoff: true } : { id, reason: trimmed });
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        if (submitted?.revision !== revision) return;
        drafts.settle(revision, error instanceof RpcError && error.code !== -32004 && error.code !== INTERNAL_CODE ? "failed" : "unknown");
        submitted = null;
        setPhase("asking");
        setFailure({ message: error.message, code: error instanceof RpcError ? error.code : null });
      }
    },
    reasonFor: (iteration) => reasons().get(iteration) ?? null,
    offersWithoutHandoff: () => failure()?.code === NOT_ACKED,
    canSubmit,
  };
};

const known = new WeakMap<Events, Map<string, Clearing>>();

/** One prompt per Workstream, shared by the Rail row's menu and its prompt. */
export const clearingOf = (app: AppSeam, events: Events, id: string, storage: ConnectedProject["drafts"]): Clearing => {
  const byId = known.get(events) ?? new Map<string, Clearing>();

  known.set(events, byId);

  const found = byId.get(id) ?? createClearing(app, events, id, storage);

  byId.set(id, found);

  return found;
};
