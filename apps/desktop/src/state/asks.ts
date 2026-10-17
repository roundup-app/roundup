import { batch, createSignal } from "solid-js";
import type { Ask } from "@contracts/ask/Ask";
import type { AskPart } from "@contracts/ask/AskPart";
import type { Target } from "@contracts/ask/Target";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";

/** U505: one Ask as the App shows it; `pending` is the optimistic entry between Enter and the Daemon's answer. */
export type AskEntry = { key: string; text: string; parts: readonly AskPart[]; pending: boolean };

export type AsksState = {
  /** Newest first; an Ask still being sent comes before every other. */
  entries(): readonly AskEntry[];
  /** Fetches `ask.list` once; later changes arrive as `ask.changed`. */
  load(): void;
  /** U504: the entry shows before the call returns. Resolves with the failure message, or `null` once the Daemon holds the Ask. */
  send(text: string): Promise<string | null>;
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
  let counter = 0;

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

    send: async (text) => {
      const key = `sending-${++counter}`;

      setPending((all) => [{ key, text, parts: [placing(text)], pending: true }, ...all]);
      setFailure(null);

      const result = await call(() => app.rpc("ask.send", { text }));

      batch(() => {
        setPending((all) => all.filter((entry) => entry.key !== key));

        if (result.ok) upsert(result.value);
        else setFailure(result.message);
      });

      return result.ok ? null : result.message;
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
