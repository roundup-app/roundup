import { batch, createSignal } from "solid-js";
import type { Ask } from "@contracts/ask/Ask";
import type { AskPart } from "@contracts/ask/AskPart";
import type { SendParams } from "@contracts/ask/SendParams";
import { RpcError } from "../app/seam";
import type { Target } from "@contracts/ask/Target";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";

/** U505: one Ask as the App shows it; `pending` is the optimistic entry between Enter and the Daemon's answer. */
export type AskEntry = { key: string; text: string; parts: readonly AskPart[]; pending: boolean };

export type AskOutcome =
  | { kind: "acknowledged"; submission: string; ask: Ask }
  | { kind: "refused" | "unknown"; submission: string; error: Error };

export type AsksState = {
  /** Newest first; an Ask still being sent comes before every other. */
  entries(): readonly AskEntry[];
  /** Fetches `ask.list` once; later changes arrive as `ask.changed`. */
  load(): void;
  /** Captured content and destination belong to one submitted revision. */
  send(text: string, captured?: Omit<SendParams, "text">): Promise<AskOutcome>;
  /** Read-only reconciliation. Absence is unknown, never a refusal. */
  reconcile(submission: string): Promise<Ask | null>;
  /** U506: `ask.pick` for one part; resolves with the failure message or `null`. */
  pick(id: string, part: number, target: Target): Promise<string | null>;
  picking(id: string, part: number): boolean;
  /** The message of the last `ask.pick` for that part that failed, until the next pick of it. */
  pickFailure(id: string, part: number): string | undefined;
  failure(): string | null;
};

/** The part an Ask holds until the Daemon's answer replaces it (A40). */
const placing = (text: string): AskPart => ({ text, placement: { kind: "unclear", question: "", candidates: [] }, state: "placing" });

export const createAsks = (app: AppSeam, events: Events): AsksState => {
  const [asks, setAsks] = createSignal<readonly Ask[]>([]);
  const [pending, setPending] = createSignal<readonly AskEntry[]>([]);
  const [picking, setPicking] = createSignal<ReadonlySet<string>>(new Set());
  const [pickFailures, setPickFailures] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [failure, setFailure] = createSignal<string | null>(null);
  let loaded = false;

  const upsert = (ask: Ask): void => {
    setAsks((all) => [ask, ...all.filter((each) => each.id !== ask.id)].sort((a, b) => Number(b.at) - Number(a.at)));
  };

  events.subscribe((event) => {
    if (event.name === "ask.changed") upsert(event.data.ask);
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
    entries: () => [...pending(), ...asks().map((ask) => ({ key: ask.id, text: ask.text, parts: ask.parts, pending: false }))],

    load: () => {
      if (loaded) return;

      loaded = true;
      void call(() => app.rpc("ask.list", null)).then((result) => {
        if (!result.ok) {
          loaded = false;
          setFailure(result.message);

          return;
        }

        batch(() => {
          setFailure(null);

          for (const ask of [...result.value].reverse()) upsert(ask);
        });
      });
    },

    send: async (text, captured) => {
      const submission = captured?.submission ?? crypto.randomUUID();
      const key = `sending-${submission}`;
      setPending((all) => [{ key, text, parts: [placing(text)], pending: true }, ...all.filter((entry) => entry.key !== key)]);
      setFailure(null);

      try {
        const ask = await app.rpc("ask.send", { text, ...captured, submission });
        batch(() => {
          setPending((all) => all.filter((entry) => entry.key !== key));
          upsert(ask);
        });

        return { kind: "acknowledged", submission, ask };
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        // INTERNAL also covers transport/plugin failures at the App boundary.
        const kind = error instanceof RpcError && [-32700, -32601, -32602, -32001, -32002, -32003].includes(error.code) ? "refused" : "unknown";
        batch(() => {
          setPending((all) => all.filter((entry) => entry.key !== key));
          setFailure(error.message);
        });

        return { kind, submission, error };
      }
    },

    reconcile: async (submission) => {
      const all = await app.rpc("ask.list", null);
      const ask = all.find((entry) => entry.submission === submission) ?? null;

      if (ask) upsert(ask);

      return ask;
    },

    pick: async (id, part, target) => {
      const key = `${id}:${part}`;

      batch(() => {
        setPicking((all) => new Set(all).add(key));

        setPickFailures((all) => {
          const next = new Map(all);
          next.delete(key);

          return next;
        });
      });

      const result = await call(() => app.rpc("ask.pick", { id, part, target }));

      batch(() => {
        setPicking((all) => {
          const next = new Set(all);
          next.delete(key);

          return next;
        });

        if (result.ok) upsert(result.value);
        else setPickFailures((all) => new Map(all).set(key, result.message));
      });

      return result.ok ? null : result.message;
    },

    picking: (id, part) => picking().has(`${id}:${part}`),
    pickFailure: (id, part) => pickFailures().get(`${id}:${part}`),
    failure,
  };
};
