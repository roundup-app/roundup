import * as v from "valibot";
import { draftStorage } from "../state/storage";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Events } from "../app/events";
import { INTERNAL_CODE, RpcError } from "../app/seam";
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
  const [rawReason, setReason] = createSignal("");
  const [reasons, setReasons] = createSignal<ReadonlyMap<number, string>>(new Map());
  let asked = "";
  let submitted: string | undefined;
  const drafts = () => retained.get(events);
  const saved = () => drafts()?.list().filter((draft) => draft.destination.surface === "rail-clear" && draft.destination.object === id).at(-1);

  const reason = () => drafts() ? v.parse(v.optional(v.string(), ""), saved()?.value.text) : rawReason();

  events.subscribe((event) => {
    if (event.name === "workstream.cleared" && event.data.id === id) {
      setReasons((now) => new Map(now).set(event.data.iteration, asked));
      setPhase("closed");
      setFailure(null);

      if (submitted) drafts()?.settle(submitted, "acknowledged");
      setReason("");
    } else if (event.name === "workstream.clearFailed" && event.data.id === id) {
      if (submitted) drafts()?.settle(submitted, "failed");
      setPhase("asking");
      setFailure({ message: event.data.message, code: event.data.code });
    }
  });

  return {
    phase,
    failure,
    reason,
    setReason: (text) => {
      setReason(text);
      drafts()?.edit({ surface: "rail-clear", object: id, recipient: id }, { text }, null, "ordinary");
    },
    open: () => {
      const text = saved()?.value.text;

      setReason(v.parse(v.optional(v.string(), ""), text));

      if (phase() === "closed") setPhase("asking");
    },
    keep: () => {
      if (phase() === "pending") return;

      setPhase("closed");
      setFailure(null);
    },
    submit: async (withoutHandoff) => {
      const trimmed = reason().trim();

      if (phase() !== "asking" || trimmed === "") return;

      if (saved()?.status === "unknown" || saved()?.status === "pending") return;
      submitted = saved()?.revision;

      if (submitted) drafts()?.submit(submitted);
      asked = trimmed;
      setPhase("pending");
      setFailure(null);

      try {
        await app.rpc("workstream.clear", withoutHandoff ? { id, reason: trimmed, without_handoff: true } : { id, reason: trimmed });
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        if (submitted) drafts()?.settle(submitted, error instanceof RpcError && error.code !== INTERNAL_CODE ? "failed" : "unknown");
        setPhase("asking");
        setFailure({ message: error.message, code: error instanceof RpcError ? error.code : null });
      }
    },
    reasonFor: (iteration) => reasons().get(iteration) ?? null,
    offersWithoutHandoff: () => failure()?.code === NOT_ACKED,
  };
};

const known = new WeakMap<Events, Map<string, Clearing>>();

/** One prompt per Workstream, shared by the Rail row's menu and its prompt. */
export const clearingOf = (app: AppSeam, events: Events, id: string): Clearing => {
  const byId = known.get(events) ?? new Map<string, Clearing>();

  known.set(events, byId);

  const found = byId.get(id) ?? createClearing(app, events, id);

  byId.set(id, found);

  return found;
};

/** Share the existing Project draft holder across the Rail's transient editors. */
const createRailDrafts = (project: string) => {
  const storage = draftStorage(project);
  const [version, setVersion] = createSignal(0);
  const refresh = () => setVersion((value) => value + 1);

  const holder = {
    list: () => {
      version();

      return storage.list().filter((draft) => draft.destination.surface.startsWith("rail-"));
    },
    problem: () => {
      version();

      return storage.problem();
    },
    edit: (...args: Parameters<typeof storage.edit>) => {
      const result = storage.edit(...args);

      refresh();

      return result.draft;
    },
    submit: (revision: string) => {
      const result = storage.submit(revision);

      refresh();

      return result;
    },
    settle: (...args: Parameters<typeof storage.settle>) => {
      storage.settle(...args);
      refresh();
    },
    discard: (revision: string) => {
      storage.discard(revision);
      refresh();
    },
    retry: () => {
      storage.retry();
      refresh();
    },
  };

  return holder;
};

const retained = new WeakMap<Events, ReturnType<typeof createRailDrafts>>();

export const railDraftsFor = (events: Events, project: string) => {
  const found = retained.get(events) ?? createRailDrafts(project);

  retained.set(events, found);

  return found;
};
