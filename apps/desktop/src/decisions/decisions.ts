import * as v from "valibot";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { AnswerParams } from "@contracts/decision/AnswerParams";
import type { PromptIdentity } from "@contracts/decision/PromptIdentity";
import type { ConnectedProject } from "../state/connectedProject";
import { RpcError } from "../app/seam";
import type { Decision } from "@contracts/decision/Decision";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit } from "../app/seam";

const outcomes = { acknowledged: "acknowledged", failed: "failed", unknown: "unknown" } as const;

const availability = { available: "available", unavailable: "unavailable", unverified: "unverified" } as const;

const draftSchema = v.object({ daemon: v.string(), agent: v.string(), attempt: v.string(), decision: v.string(), choice: v.nullable(v.string()), note: v.string() });

/** Stable storage destination: a reused Decision id must not replace an older Prompt's draft. */
export const promptKey = (prompt: PromptIdentity): string => JSON.stringify([prompt.daemon, prompt.agent, prompt.attempt, prompt.decision]);

export type DecisionsState = {
  /** Read-only Prompt authority for this connection; pending or failed reads grant none. */
  availability(prompt: PromptIdentity): "available" | "unavailable" | "unverified";
  /** The Decision the Agent (or a Workstream's Door) waits on; the newest when a replacement is still arriving. */
  of(agent: string | null): Decision | undefined;
  /** U423: every open Decision, oldest first. */
  open(): readonly Decision[];
  /** The message of the last failed `decision.list`, until a later list succeeds. */
  listFailure(): string | null;
  retryList(): void;
  answering(id: string): boolean;
  answerFailure(id: string): string | null;
  /** `answer` is a permission word or an `ask_user` label; null with a note is the user's own answer (H14). */
  answer(id: string, answer: string | null, note?: string, identity?: PromptIdentity): Promise<"acknowledged" | "failed" | "unknown">;
};

/**
 * Subscribes before it lists, and reconciles by id: an id an Event touched while a list was in flight keeps what the
 * Event said, so an old list neither resurrects a cleared Decision nor overwrites its replacement.
 */
export const createDecisions = (app: AppSeam, events: Events, daemonExit: Accessor<DaemonExit | null>, drafts: Pick<ConnectedProject["drafts"], "list" | "validate" | "registerRecovery">): DecisionsState => {
  const [decisions, setDecisions] = createSignal<readonly Decision[]>([]);
  const [listFailure, setListFailure] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [observed, setObserved] = createSignal(false);
  let reading: Set<string> | null = null;

  drafts.validate("decisions", draftSchema);
  drafts.registerRecovery("decisions", (draft, facts) => {
    const parsed = v.safeParse(draftSchema, draft.value);

    if (!parsed.success || parsed.output.agent !== draft.destination.recipient) return availability.unverified;
    const prompt = parsed.output;

    if (draft.destination.object !== prompt.decision && draft.destination.object !== promptKey(prompt)) return availability.unverified;

    return facts.decisions.availability(parsed.output);
  });

  // The resource belongs to this connection. App-run resolvers use only the inspected facts,
  // so replacing a connection cannot revive its old captures or overwrite a newer read.
  const [authority] = createResource(() => ({
    open: decisions(), observed: observed(), failure: listFailure(), exited: daemonExit(),
    requested: new Set(drafts.list().filter((draft) => draft.destination.surface === "decisions").map((draft) => String(draft.value.decision))),
  }), async (facts) => {
    const captures = new Map<string, PromptIdentity | "unavailable" | "unverified">();

    if (!facts.observed || facts.failure || facts.exited) return captures;

    await Promise.all(facts.open.filter((decision) => facts.requested.has(decision.id)).map(async (decision) => {
      try {
        captures.set(decision.id, await app.rpc("decision.capture", { id: decision.id }));
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        captures.set(decision.id, error instanceof RpcError && error.code === -32003 ? availability.unavailable : availability.unverified);
      }
    }));

    return captures;
  });

  const without = (id: string) => setDecisions((current) => current.filter((each) => each.id !== id));

  const forget = (id: string) => {
    reading?.add(id);
    without(id);
    setFailures((current) => new Map([...current].filter(([key]) => key !== id)));
  };

  onCleanup(events.subscribe((event) => {
    if (event.name === "decision.opened") {
      reading?.add(event.data.id);
      setDecisions((current) => [...current.filter((each) => each.id !== event.data.id), event.data]);
    } else if (event.name === "decision.cleared") {
      forget(event.data.id);
    }
  }));

  const list = async (): Promise<void> => {
    if (reading !== null || daemonExit() !== null) return;

    const touched = new Set<string>();

    reading = touched;

    try {
      const listed = await app.rpc("decision.list", null);

      setDecisions((current) => [...current.filter((each) => touched.has(each.id)), ...listed.filter((each) => !touched.has(each.id))]);
      setListFailure(null);
      setObserved(true);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setListFailure(thrown.message);
    } finally {
      if (reading === touched) reading = null;
    }
  };

  void list();

  const answer = async (id: string, text: string | null, note?: string, identity?: PromptIdentity): Promise<"acknowledged" | "failed" | "unknown"> => {
    if (daemonExit() !== null || pending().has(id)) return outcomes.unknown;

    setPending((current) => new Set(current).add(id));
    setFailures((current) => new Map([...current].filter(([key]) => key !== id)));

    let sent = false;

    try {
      const proof = await app.daemonProof();

      // A permission answer sends no note (H14).
      const params: AnswerParams = { id, answer: text, proof };

      if (identity) params.identity = identity;

      sent = true;
      await app.rpc("decision.answer", note === undefined ? params : { ...params, note });
      forget(id);

      return outcomes.acknowledged;
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailures((current) => new Map(current).set(id, thrown.message));

      return !sent || thrown instanceof RpcError && [-32700, -32601, -32602, -32001, -32002, -32003].includes(thrown.code) ? outcomes.failed : outcomes.unknown;
    } finally {
      setPending((current) => new Set([...current].filter((key) => key !== id)));
    }
  };

  return {
    availability: (prompt) => {
      if (daemonExit()) return availability.unavailable;

      if (!observed() || listFailure()) return availability.unverified;

      if (!decisions().some((decision) => decision.id === prompt.decision && decision.agent === prompt.agent)) return availability.unavailable;

      if (authority.loading) return availability.unverified;

      const captured = authority()?.get(prompt.decision);

      if (!captured || captured === "unverified") return availability.unverified;

      if (captured === "unavailable") return availability.unavailable;

      return captured.daemon === prompt.daemon && captured.agent === prompt.agent && captured.attempt === prompt.attempt && captured.decision === prompt.decision ? availability.available : availability.unavailable;
    },
    of: (agent) => decisions().filter((each) => each.agent === agent).reduce<Decision | undefined>((newest, each) => (!newest || each.opened_at >= newest.opened_at ? each : newest), undefined),
    open: () => decisions().toSorted((a, b) => a.opened_at - b.opened_at),
    listFailure,
    retryList: () => void list(),
    answering: (id) => pending().has(id),
    answerFailure: (id) => failures().get(id) ?? null,
    answer,
  };
};
