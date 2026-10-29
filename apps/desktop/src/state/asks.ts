import { batch, createEffect, createSignal } from "solid-js";
import type { Ask } from "@contracts/ask/Ask";
import type { AskPart } from "@contracts/ask/AskPart";
import type { Target } from "@contracts/ask/Target";
import { outcomeOf, RpcError, type AppSeam } from "../app/seam";
import type { SendParams } from "@contracts/ask/SendParams";
import type { Events } from "../app/events";
import * as v from "valibot";
import { storageSchema, storedValue } from "./storage";
import { copy } from "../copy";

/** U505: one Ask as the App shows it; `pending` is the optimistic entry between Enter and the Daemon's answer. */
export type AskEntry = { key: string; text: string; parts: readonly AskPart[]; pending: boolean };

/** A captured revision identity is echoed even when replies arrive out of order. */
export type AskSubmission = SendParams & { submission: string };

export type AskOutcome =
  | { kind: "acknowledged"; submission: string; ask: Ask }
  | { kind: "refused"; submission: string; error: RpcError }
  | { kind: "unknown"; submission: string; message: string };

/** P3557c: one failure with an identity of its own; dismissing it never touches a later failure that reads the same. */
export type AskFailure = { id: number; message: string };

export type IntakeFailure = AskFailure & { kind: "refused" | "unknown"; submission: string; destination: string | null };

export type AsksState = {
  /** Newest first; an Ask still being sent comes before every other. */
  entries(): readonly AskEntry[];
  /** U505: exact Sent parts already viewed at their destination. */
  acknowledged(entry: AskEntry, index: number): boolean;
  /** Fetches `ask.list` once; later changes arrive as `ask.changed`. */
  load(): void;
  loadState(): "loading" | "ready" | "failed";
  /** U504: optimistic entry appears before intake settles. Acknowledgement means durable intake, not delivery. */
  send(request: AskSubmission): Promise<AskOutcome>;
  /** Read-only authoritative acceptance lookup. Absence cannot prove refusal of an in-flight request. */
  reconcile(submission: string): Promise<AskOutcome>;
  /** U506: `ask.pick` for one part; resolves with the failure message or `null`. */
  pick(id: string, part: number, target: Target): Promise<string | null>;
  picking(id: string, part: number): boolean;
  /** The message of the last `ask.pick` for that part that failed, until that part's acknowledged pick or its dismissal. */
  pickFailure(id: string, part: number): string | undefined;
  /** The `ask.list` load failure, else the intake failure's message. */
  failure(): string | null;
  /** P3557c: the `ask.list` load failure; only its own successful load or `dismiss` clears it. */
  listFailure(): AskFailure | null;
  /** P3557c: the last intake refusal or uncertain intake with its submission revision and captured destination. */
  intakeFailure(): IntakeFailure | null;
  /** P3557c: the failure of the last `ask.pick` of that part; a retry keeps it until the part's acknowledged pick. */
  partFailure(id: string, part: number): AskFailure | undefined;
  /** P3557c: clears exactly this failure; no RPC, no Ask change, no draft touched. */
  dismiss(failure: AskFailure): void;
};

/** The part an Ask holds until the Daemon's answer replaces it (A40). */
const placing = (text: string): AskPart => ({ text, placement: { kind: "unclear", question: "", candidates: [] }, state: "placing" });

const acknowledgedSchema = storageSchema("roundup:ask-acknowledged", v.array(v.string()));

const partKey = (entry: Pick<AskEntry, "key" | "parts">, index: number): string => {
  const part = entry.parts[index];
  const placement = part?.placement;

  return JSON.stringify([entry.key, index, part?.text, placement?.kind, placement?.kind === "unclear" ? placement.question : placement?.workstream]);
};

export const createAsks = (app: AppSeam, events: Events, viewed?: { path: string; target(): string | null }): AsksState => {
  const storage = storedValue(`roundup:ask-acknowledged:${viewed?.path ?? ""}`, acknowledgedSchema);
  const [acknowledged, setAcknowledged] = createSignal<readonly string[]>(storage.read() ?? []);
  const [asks, setAsks] = createSignal<readonly Ask[]>([]);
  const [pending, setPending] = createSignal<readonly AskEntry[]>([]);
  const [picking, setPicking] = createSignal<ReadonlySet<string>>(new Set());
  const [pickFailures, setPickFailures] = createSignal<ReadonlyMap<string, AskFailure>>(new Map());
  const [listFailure, setListFailure] = createSignal<AskFailure | null>(null);
  const [intakeFailure, setIntakeFailure] = createSignal<IntakeFailure | null>(null);
  let sequence = 0;
  const fail = (message: string): AskFailure => ({ id: ++sequence, message });
  let loaded = false;
  const [loadState, setLoadState] = createSignal<"loading" | "ready" | "failed">("loading");

  const upsert = (ask: Ask): void => {
    const invalid = new Set(ask.parts.flatMap((part, index) => part.state !== "typed" ? [partKey({ key: ask.id, parts: ask.parts }, index)] : []));
    const kept = acknowledged().filter(key => !invalid.has(key));

    if (kept.length !== acknowledged().length) {
      setAcknowledged(kept);
      void storage.write(kept);
    }

    setAsks((all) => [ask, ...all.filter((each) => each.id !== ask.id)].sort((a, b) => Number(b.at) - Number(a.at)));
  };

  events.subscribe((event) => {
    if (event.name === "ask.changed") upsert(event.data.ask);
  });

  createEffect(() => {
    const target = viewed?.target();

    if (!target) return;

    const keys = asks().flatMap(ask => ask.parts.flatMap((part, index) => {
      const destination = part.placement.kind === "unclear" ? null : part.placement.workstream;

      return part.state === "typed" && destination === target ? [partKey({ key: ask.id, parts: ask.parts }, index)] : [];
    }));

    const next = [...new Set([...acknowledged(), ...keys])];

    if (next.length === acknowledged().length) return;

    setAcknowledged(next);
    void storage.write(next);
  });

  type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

  const call = async <T,>(run: () => Promise<T>): Promise<Outcome<T>> => {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { ok: false, message: error.message };
    }
  };

  return {
    acknowledged: (entry, index) => !entry.pending && entry.parts[index]?.state === "typed" && acknowledged().includes(partKey(entry, index)),
    entries: () => [...pending(), ...asks().map((ask) => ({ key: ask.id, text: ask.text, parts: ask.parts, pending: false }))],

    loadState,
    load: () => {
      if (loaded) return;

      loaded = true;
      setLoadState("loading");
      void call(() => app.rpc("ask.list", null)).then((result) => {
        if (!result.ok) {
          loaded = false;
          setLoadState("failed");
          setListFailure(fail(result.message));

          return;
        }

        batch(() => {
          setLoadState("ready");
          setListFailure(null);

          for (const ask of [...result.value].reverse()) upsert(ask);
        });
      });
    },

    send: async (request) => {
      // Copy before awaiting: later editor mutations cannot change this submission.
      const captured = { ...request };
      const { text, submission } = captured;
      const key = submission;
      setPending((all) => [{ key, text, parts: [placing(text)], pending: true }, ...all.filter(entry => entry.key !== key)]);

      try {
        const ask = await app.rpc("ask.send", captured);
        upsert(ask);
        setIntakeFailure(null);

        return { kind: "acknowledged", submission, ask };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // INTERNAL and UNKNOWN_OUTCOME can follow committed intake; neither proves refusal.
        const refused = outcomeOf(error) === "failed";
        setIntakeFailure({ ...fail(message), kind: refused ? "refused" : "unknown", submission, destination: captured.workstream ?? null });

        if (refused && error instanceof RpcError) return { kind: "refused", submission, error };

        return { kind: "unknown", submission, message };
      } finally {
        setPending((all) => all.filter((entry) => entry.key !== key));
      }
    },

    reconcile: async (submission) => {
      try {
        const records = await app.rpc("ask.list", null);
        const ask = records.find(ask => ask.submission === submission);

        if (ask) {
          upsert(ask);
          setIntakeFailure(null);

          return { kind: "acknowledged", submission, ask };
        }

        return { kind: "unknown", submission, message: copy.askNoAcknowledgement };
      } catch (error) {
        return { kind: "unknown", submission, message: error instanceof Error ? error.message : String(error) };
      }
    },

    pick: async (id, part, target) => {
      const key = `${id}:${part}`;

      batch(() => {
        setPicking((all) => new Set(all).add(key));
      });

      const result = await call(() => app.rpc("ask.pick", { id, part, target }));

      batch(() => {
        setPicking((all) => {
          const next = new Set(all);
          next.delete(key);

          return next;
        });

        if (result.ok) {
          upsert(result.value);

          setPickFailures((all) => {
            const next = new Map(all);
            next.delete(key);

            return next;
          });
        } else {
          setPickFailures((all) => new Map(all).set(key, fail(result.message)));
        }
      });

      return result.ok ? null : result.message;
    },

    picking: (id, part) => picking().has(`${id}:${part}`),
    pickFailure: (id, part) => pickFailures().get(`${id}:${part}`)?.message,
    failure: () => listFailure()?.message ?? intakeFailure()?.message ?? null,
    listFailure,
    intakeFailure,
    partFailure: (id, part) => pickFailures().get(`${id}:${part}`),

    dismiss: (target) => {
      batch(() => {
        if (listFailure()?.id === target.id) setListFailure(null);

        if (intakeFailure()?.id === target.id) setIntakeFailure(null);

        if ([...pickFailures().values()].some((each) => each.id === target.id)) {
          setPickFailures((all) => new Map([...all].filter(([, each]) => each.id !== target.id)));
        }
      });
    },
  };
};
