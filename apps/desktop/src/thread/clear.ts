import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Events } from "../app/events";
import { RpcError } from "../app/seam";
import type { AppSeam } from "../app/seam";

const NOT_ACKED = -32008;

export type ClearPhase = "closed" | "asking" | "pending";

export type Clearing = {
  phase: Accessor<ClearPhase>;
  /** `✕ <message>` of the last failed clear, with the code that decides the second word. */
  failure: Accessor<{ message: string; code: number | null } | null>;
  reason: Accessor<string>;
  setReason(text: string): void;
  open(): void;
  keep(): void;
  /** One `workstream.clear` with the trimmed reason; none while the reason is empty or a clear is pending. */
  submit(withoutHandoff: boolean): Promise<void>;
  /** The reason a clear gave for each Iteration it began, for the rule above it. */
  reasonFor(iteration: number): string | null;
  offersWithoutHandoff(): boolean;
};

/** U350: the reason prompt of one Workstream. */
const createClearing = (app: AppSeam, events: Events, id: string): Clearing => {
  const [phase, setPhase] = createSignal<ClearPhase>("closed");
  const [failure, setFailure] = createSignal<{ message: string; code: number | null } | null>(null);
  const [reason, setReason] = createSignal("");
  const [reasons, setReasons] = createSignal<ReadonlyMap<number, string>>(new Map());
  let asked = "";

  events.subscribe((event) => {
    if (event.name === "workstream.cleared" && event.data.id === id) {
      setReasons((now) => new Map(now).set(event.data.iteration, asked));
      setPhase("closed");
      setFailure(null);
      setReason("");
    } else if (event.name === "workstream.clearFailed" && event.data.id === id) {
      setPhase("asking");
      setFailure({ message: event.data.message, code: event.data.code });
    }
  });

  return {
    phase,
    failure,
    reason,
    setReason,
    open: () => {
      if (phase() === "closed") setPhase("asking");
    },
    keep: () => {
      if (phase() === "pending") return;

      setPhase("closed");
      setFailure(null);
      setReason("");
    },
    submit: async (withoutHandoff) => {
      const trimmed = reason().trim();

      if (phase() !== "asking" || trimmed === "") return;

      asked = trimmed;
      setPhase("pending");
      setFailure(null);

      try {
        await app.rpc("workstream.clear", withoutHandoff ? { id, reason: trimmed, without_handoff: true } : { id, reason: trimmed });
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        setPhase("asking");
        setFailure({ message: error.message, code: error instanceof RpcError ? error.code : null });
      }
    },
    reasonFor: (iteration) => reasons().get(iteration) ?? null,
    offersWithoutHandoff: () => failure()?.code === NOT_ACKED,
  };
};

const known = new WeakMap<Events, Map<string, Clearing>>();

/** One prompt per Workstream, shared by the Thread's header and the Rail row's menu. */
export const clearingOf = (app: AppSeam, events: Events, id: string): Clearing => {
  const byId = known.get(events) ?? new Map<string, Clearing>();

  known.set(events, byId);

  const found = byId.get(id) ?? createClearing(app, events, id);

  byId.set(id, found);

  return found;
};
