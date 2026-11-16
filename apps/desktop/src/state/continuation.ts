import { createMemo, createResource, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { ContinuationAction } from "@contracts/message/ContinuationAction";
import type { ResumeWorkParams } from "@contracts/message/ResumeWorkParams";
import type { AppSeam } from "../app/seam";
import { isDoor } from "./doorNode";

/** What one read of the Daemon saw: the state of each Door it read at, and the work still open then. */
type Seen = { keys: ReadonlyMap<string, string>; open: ReadonlyMap<string, readonly ContinuationAction[]> };

/** A resume that failed, good only while its Door stays in the state it failed at. */
type Failed = { cause: Error; door: string | undefined };

type Resumed = "resumed" | "nothing" | "failed";

/** What a resume of every Agent came to. */
export type Tally = { resumed: number; failed: number };

const unread: Seen = { keys: new Map(), open: new Map() };

/**
 * U7211a: the Doors that can hold work to resume, each with the state a read of it is good for. Only a stopped Door
 * (idle or done) with a Terminal qualifies: one that works is on its way, one that asks or failed has the user's
 * attention already (P3), and one with no Terminal has nobody to hand the work to.
 */
const readable = (nodes: readonly RailNode[]): ReadonlyMap<string, string> => new Map(nodes.flatMap(node =>
  isDoor(node) && node.attempt !== null && node.terminal_id !== null && (node.status?.kind === "idle" || node.status?.kind === "done") ? [[node.id, `${node.attempt}/${node.status_revision}`] as const] : []));

const sameKeys = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) => a.size === b.size && [...a].every(([id, key]) => b.get(id) === key);

/**
 * U7211a to U7211d: which Agents have unfinished work, read from `message.reconcileWork` once per Door state, and the
 * user's choice to resume it. Nothing resumes without a call to `resume` or `resumeAll`.
 */
export const createContinuation = (app: AppSeam, project: string, nodes: Accessor<readonly RailNode[]>, live: Accessor<boolean>) => {
  const doors = createMemo(() => live() ? readable(nodes()) : new Map<string, string>(), undefined, { equals: sameKeys });

  const [seen, { mutate, refetch }] = createResource(doors, async (wanted, { value }) => {
    const known = value ?? unread;

    const entries = await Promise.all([...wanted].map(async ([id, key]) => {
      if (known.keys.get(id) === key) return [id, known.open.get(id) ?? []] as const;

      const plan = await app.rpc("message.reconcileWork", { project, id });

      return [id, plan.actions.filter(action => action.decision === null)] as const;
    }));

    return { keys: wanted, open: new Map(entries) };
  }, { initialValue: unread });

  const open = (id: string): readonly ContinuationAction[] => seen.error ? [] : seen.latest.open.get(id) ?? [];

  const agents = (): string[] => seen.error ? [] : [...seen.latest.open].flatMap(([id, actions]) => actions.length > 0 ? [id] : []);

  const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = createSignal<ReadonlyMap<string, Failed>>(new Map());
  const requests = new Map<string, { identity: string; request: string }>();

  /** One request id carries one payload, and survives a failure so the Daemon answers a retry from what it accepted. */
  const requestFor = (id: string, actions: readonly ContinuationAction[]): ResumeWorkParams => {
    const identity = actions.map(action => action.id).join("\n");
    const held = requests.get(id);
    const request = held?.identity === identity ? held.request : crypto.randomUUID();
    const [only] = actions;

    requests.set(id, { identity, request });

    return only !== undefined && actions.length === 1 ? { project, id, request, action: only.id } : { project, id, request };
  };

  const handled = (id: string) => mutate(previous => ({ keys: previous?.keys ?? new Map(), open: new Map(previous?.open).set(id, []) }));

  const resume = async (id: string): Promise<Resumed> => {
    const actions = open(id);

    if (actions.length === 0 || busy().has(id) || !live()) return "nothing";

    setFailed(previous => new Map([...previous].filter(([each]) => each !== id)));
    setBusy(previous => new Set(previous).add(id));

    try {
      const answer = await app.rpc("message.resumeWork", requestFor(id, actions));

      requests.delete(id);
      handled(id);

      return answer.decision === null ? "nothing" : "resumed";
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailed(previous => new Map(previous).set(id, { cause: thrown, door: doors().get(id) }));

      return "failed";
    } finally {
      setBusy(previous => new Set([...previous].filter(each => each !== id)));
    }
  };

  const resumeAll = async (): Promise<Tally> => {
    const outcomes = await Promise.all(agents().map(resume));

    return { resumed: outcomes.filter(outcome => outcome === "resumed").length, failed: outcomes.filter(outcome => outcome === "failed").length };
  };

  return {
    /** How many Agents have unfinished work, dismissed or not. */
    count: () => agents().length,
    /** Whether the Agent's bar shows: it has work the user has not dismissed. */
    shown: (id: string) => open(id).some(action => !dismissed().has(action.id)),
    busy: (id: string) => busy().has(id),
    /** Why the last resume of this Agent failed, until it works again or its Door changes. */
    failure: (id: string): Error | null => {
      const held = failed().get(id);

      return held !== undefined && held.door === doors().get(id) ? held.cause : null;
    },
    /** Why the read of unfinished work failed. */
    readFailure: (): Error | null => seen.error instanceof Error ? seen.error : null,
    reread: () => void refetch(),
    resume,
    resumeAll,
    dismiss: (id: string) => setDismissed(previous => new Set([...previous, ...open(id).map(action => action.id)])),
  };
};

export type Continuation = ReturnType<typeof createContinuation>;
