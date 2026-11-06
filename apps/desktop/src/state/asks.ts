import { batch, createEffect, createSignal } from "solid-js";
import type { Ask } from "@contracts/ask/Ask";
import type { AskPart } from "@contracts/ask/AskPart";
import type { Target } from "@contracts/ask/Target";
import { outcomeOf, RpcError, type App, type AppSeam, type Project } from "../app/seam";
import type { SendParams } from "@contracts/ask/SendParams";
import type { PlacedPart } from "@contracts/ask/PlacedPart";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Events } from "../app/events";
import * as v from "valibot";
import { storageSchema, storedValue } from "./storage";
import { copy } from "./copy";

/** U505: one Ask as the App shows it; `pending` is the optimistic entry between Enter and the Daemon's answer. */
export type AskEntry = { key: string; at?: number; text: string; parts: readonly AskPart[]; pending: boolean };

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
  /** U6271b: the open Projects a part can go to; fewer than two means the chip is not shown. */
  projects(): readonly Project[];
  /** U6271b: one `ask.place` call over every open Project's Workstreams; stores no Ask. */
  place(text: string): Promise<readonly PlacedPart[]>;
  /** U6271c: the Project a part went to and how to reach its Workstreams; `null` with fewer than two open Projects. */
  destination(entry: AskEntry, index: number): AskDestination | null;
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

/** U6271c: where a part went; `local` is the Project this Ask list belongs to. */
export type AskDestination = { project: Project; local: boolean; nodes(): readonly RailNode[]; open(id: string): void };

/** The part an Ask holds until the Daemon's answer replaces it (A40). */
const placing = (text: string): AskPart => ({ text, placement: { kind: "unclear", question: "", candidates: [] }, state: "placing" });

/**
 * U6271a: sends each placed part to the Daemon of its own Project, in order, verbatim.
 * A `routed` part types into its Workstream; a `new` part fixes `project` so that Daemon starts the Workstream (A42).
 * An `unclear` part is stored `waiting` by `active` until `ask.pick` (A42); a part naming no open Project goes to `active`.
 * Part `index` is sent as submission `<submission>:<index>`, so an equal retry replays the same Ask (A40).
 */
export const sendPlaced = async (
  app: Pick<App, "forProject">,
  active: AppSeam,
  open: readonly Project[],
  submission: string,
  parts: readonly PlacedPart[],
): Promise<Ask[]> => {
  const sent: Ask[] = [];

  for (const [index, part] of parts.entries()) {
    const { placement } = part;

    const owner = placement.kind === "unclear" ? undefined : open.find(project => project.name === placement.project);
    const daemon = owner ? app.forProject(owner.path) : active;
    const id = `${submission}:${index}`;

    const request: SendParams = placement.kind === "routed"
      ? { text: part.text, submission: id, workstream: placement.workstream }
      : { text: part.text, submission: id, parts: [part] };

    if (placement.kind === "new" && placement.project) request.project = placement.project;

    sent.push(await daemon.rpc("ask.send", request));
  }

  return sent;
};

const acknowledgedSchema = storageSchema("roundup:ask-acknowledged", v.array(v.string()));

const partKey = (entry: Pick<AskEntry, "key" | "parts">, index: number): string => {
  const part = entry.parts[index];
  const placement = part?.placement;

  return JSON.stringify([entry.key, index, part?.text, placement?.kind, placement?.kind === "unclear" ? placement.question : placement?.workstream]);
};

/** Where placed parts go: each to the Daemon of the open Project it names. */
export type AskRouting = {
  app: Pick<App, "forProject">;
  open(): readonly Project[];
  /** U6271c: a Project's Rail nodes; empty while it is not connected. */
  nodes?(path: string): readonly RailNode[];
  /** U6271c: shows that Project, then selects the Workstream in it. */
  show?(path: string, workstream: string): void;
};

export const createAsks = (app: AppSeam, events: Events, viewed?: { path: string; target(): string | null }, routing?: AskRouting): AsksState => {
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
    entries: () => [...pending(), ...asks().map((ask) => ({ key: ask.id, at: Number(ask.at), text: ask.text, parts: ask.parts, pending: false }))],

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
        let ask: Ask;

        if (routing && captured.parts?.length) {
          // U6271a: every part reaches a Daemon; an empty list has nothing to acknowledge.
          const sent = await sendPlaced(routing.app, app, routing.open(), submission, captured.parts);
          const first = sent[0];

          if (!first) throw new Error(copy.askNoAcknowledgement);
          sent.forEach(upsert);
          ask = first;
        } else {
          // U6271b: a fixed Project is placed within by the Daemon that owns it.
          const owner = routing && captured.project ? routing.open().find(project => project.name === captured.project) : undefined;
          ask = await (owner ? routing!.app.forProject(owner.path) : app).rpc("ask.send", captured);
          upsert(ask);
        }

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
        // Routed parts are stored as `<submission>:<index>` by the Daemon of each part's Project.
        const own = (ask: Ask): boolean => ask.submission === submission || (ask.submission?.startsWith(`${submission}:`) ?? false);
        const doors = routing ? [app, ...routing.open().map(project => routing.app.forProject(project.path))] : [app];
        const lists = await Promise.all(doors.map(door => door.rpc("ask.list", null)));
        const ask = lists.flat().find(own);

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

    projects: () => routing?.open() ?? [],

    place: async (text) => {
      const open = routing?.open() ?? [];
      const projects = await Promise.all(open.map(async project => ({ name: project.name, tree: await routing!.app.forProject(project.path).rpc("rail.tree", null) })));

      return app.rpc("ask.place", { text, projects });
    },

    destination: (entry, index) => {
      const open = routing?.open() ?? [];
      const placement = entry.parts[index]?.placement;

      if (!routing || open.length < 2 || !placement) return null;

      const named = placement.kind === "unclear" ? undefined : open.find(project => project.name === placement.project);
      const project = named ?? open.find(each => each.path === viewed?.path);

      if (!project) return null;

      const local = project.path === viewed?.path;

      return {
        project,
        local,
        nodes: () => routing.nodes?.(project.path) ?? [],
        open: (id) => {
          routing.show?.(project.path, id);
          const key = partKey(entry, index);

          if (!acknowledged().includes(key) && entry.parts[index]?.state === "typed") {
            const next = [...acknowledged(), key];
            setAcknowledged(next);
            void storage.write(next);
          }
        },
      };
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
