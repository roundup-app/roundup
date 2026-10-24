import * as v from "valibot";
import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { AnswerParams } from "@contracts/decision/AnswerParams";
import type { Scope } from "@contracts/decision/Scope";
import type { PromptIdentity } from "@contracts/decision/PromptIdentity";
import type { ConnectedProject } from "../state/connectedProject";
import { RpcError } from "../app/seam";
import type { Decision } from "@contracts/decision/Decision";
import type { Events } from "../app/events";
import { copy } from "../copy";
import { readPermission } from "./permission";
import type { AppSeam, DaemonExit } from "../app/seam";

/** U3750: a refusal for a lost prompt identity names the Terminal, never a Decision id or Attempt. */
export const plainRefusal = (message: string): string => /original prompt|identity/.test(message) ? copy.answerInTheTerminal : message;

const outcomes = { acknowledged: "acknowledged", failed: "failed", unknown: "unknown" } as const;

const availability = { available: "available", unavailable: "unavailable", unverified: "unverified" } as const;

const draftSchema = v.object({ daemon: v.string(), agent: v.string(), attempt: v.string(), decision: v.string(), choice: v.nullable(v.string()), note: v.string(), selectedRevision: v.optional(v.string()) });

/** Stable storage destination: a reused Decision id must not replace an older Prompt's draft. */
export const promptKey = (prompt: PromptIdentity): string => JSON.stringify([prompt.daemon, prompt.agent, prompt.attempt, prompt.decision]);

/** U3795: the one line an answered permission Card folds to; memory only. */
export type Folded = { id: string; agent: string; verdict: Scope | "denied"; target: string; removed: boolean };

type AnswerFailure = { message: string | null; dismissed: string | null };

export type DecisionsState = {
  /** U3795: the line that replaced `agent`'s answered Card, until its next Decision, a dismissal or its removal. */
  folded(agent: string | null): Folded | undefined;
  dismiss(agent: string): void;
  /** U3795: remove the `project` Grant of a folded line once; false while a call is pending. */
  revoke(agent: string): Promise<void>;
  revoking(agent: string): boolean;
  revokeFailure(agent: string): string | null;
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
  dismissFailure(id: string): void;
  dismissRevokeFailure(agent: string): void;
  /** `answer` is a permission word or an `ask_user` label; null with a note is the user's own answer (H14). */
  answer(id: string, answer: string | null, note?: string, identity?: PromptIdentity, scope?: Scope): Promise<"acknowledged" | "failed" | "unknown">;
};

/**
 * Subscribes before it lists, and reconciles by id: an id an Event touched while a list was in flight keeps what the
 * Event said, so an old list neither resurrects a cleared Decision nor overwrites its replacement.
 */
export const createDecisions = (app: AppSeam, events: Events, daemonExit: Accessor<DaemonExit | null>, drafts: Pick<ConnectedProject["drafts"], "list" | "validate" | "registerRecovery">, present: Accessor<ReadonlySet<string> | null> = () => null): DecisionsState => {
  const [decisions, setDecisions] = createSignal<readonly Decision[]>([]);
  const [listFailure, setListFailure] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = createSignal<ReadonlyMap<string, AnswerFailure>>(new Map());
  const [observed, setObserved] = createSignal(false);
  const [folds, setFolds] = createSignal<ReadonlyMap<string, Folded>>(new Map());
  const [revokes, setRevokes] = createSignal<ReadonlySet<string>>(new Set());
  const [revokeFailures, setRevokeFailures] = createSignal<ReadonlyMap<string, string>>(new Map());
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
  const requestedIds = createMemo(() => [...new Set(drafts.list()
    .filter((draft) => draft.destination.surface === "decisions")
    .map((draft) => String(draft.value.decision)))].sort(), undefined, { equals: (before, after) => before.length === after.length && before.every((id, at) => id === after[at]) });

  const [authority] = createResource(() => ({
    open: decisions(), observed: observed(), failure: listFailure(), exited: daemonExit(),
    requested: new Set(requestedIds()),
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

  const unfold = (agent: string) => {
    setFolds((current) => new Map([...current].filter(([key]) => key !== agent)));
    setRevokeFailures((current) => new Map([...current].filter(([key]) => key !== agent)));
  };

  // An observed empty Rail also removes the last folded line.
  createEffect(() => {
    const agents = present();

    if (agents !== null) for (const agent of folds().keys()) if (!agents.has(agent)) unfold(agent);
  });

  const without = (id: string) => setDecisions((current) => current.filter((each) => each.id !== id));

  // The shared clock may list the same refused answer again; only a new observation resurfaces it.
  const refusalKey = (decision: Decision) => {
    const failure = decision.failure;

    return JSON.stringify([decision.agent, decision.opened_at, decision.tool, decision.args, failure?.attempt, failure?.failed_at, failure?.error_code, failure?.message, failure?.answered_by.kind, failure?.answered_by.id, failure?.answered_by.parent]);
  };

  const withoutDismissedFailure = (decision: Decision): Decision => {
    const failure = failures().get(decision.id);

    if (!decision.failure || failure?.dismissed !== refusalKey(decision)) return decision;
    const next = { ...decision };

    delete next.failure;

    return next;
  };

  const dismissFailure = (id: string) => {
    const decision = decisions().find(each => each.id === id);

    setFailures(current => {
      const next = new Map(current);

      const dismissed = decision?.failure ? refusalKey(decision) : current.get(id)?.dismissed ?? null;

      if (dismissed) next.set(id, { message: null, dismissed });
      else next.delete(id);

      return next;
    });
    setDecisions(current => current.map(withoutDismissedFailure));
  };

  const forget = (id: string) => {
    reading?.add(id);
    without(id);
    setFailures((current) => new Map([...current].filter(([key]) => key !== id)));
  };

  onCleanup(events.subscribe((event) => {
    if (event.name === "decision.opened") {
      unfold(event.data.agent);
      reading?.add(event.data.id);
      setDecisions((current) => [...current.filter((each) => each.id !== event.data.id), withoutDismissedFailure(event.data)]);
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

      setDecisions((current) => [...current.filter((each) => touched.has(each.id)), ...listed.filter((each) => !touched.has(each.id)).map(withoutDismissedFailure)]);
      setFailures(current => new Map([...current].filter(([id]) => decisions().some(each => each.id === id))));
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

  const answer = async (id: string, text: string | null, note?: string, identity?: PromptIdentity, scope?: Scope): Promise<"acknowledged" | "failed" | "unknown"> => {
    if (daemonExit() !== null || pending().has(id)) return outcomes.unknown;

    // Read before the call: the Daemon's cleared Event may remove the Decision before the reply arrives.
    const asked = decisions().find((each) => each.id === id);

    setPending((current) => new Set(current).add(id));

    let sent = false;

    try {
      const proof = await app.daemonProof();

      // A permission answer sends no note (H14).
      const params: AnswerParams = { id, answer: text, proof };

      if (scope && scope !== "once") params.scope = scope;

      if (identity) params.identity = identity;

      sent = true;
      await app.rpc("decision.answer", note === undefined ? params : { ...params, note });
      const current = decisions().find(each => each.id === id);
      const original = !current || current.agent === asked?.agent && current.opened_at === asked.opened_at && current.args === asked.args;

      if (original) forget(id);

      if (original && !decisions().some(each => each.agent === asked?.agent) && asked && asked.answerable && asked.tool !== "ask_user" && (text === "allow" || text === "deny")) {
        setFolds((current) => new Map(current).set(asked.agent, { id, agent: asked.agent, verdict: text === "deny" ? "denied" : scope ?? "once", target: readPermission(asked).target, removed: false }));
      }

      return outcomes.acknowledged;
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (decisions().some(each => each.id === id && each.agent === asked?.agent && each.opened_at === asked.opened_at && each.args === asked.args)) setFailures((current) => new Map(current).set(id, { message: plainRefusal(thrown.message), dismissed: current.get(id)?.dismissed ?? null }));

      return !sent || thrown instanceof RpcError && [-32700, -32601, -32602, -32001, -32002, -32003].includes(thrown.code) ? outcomes.failed : outcomes.unknown;
    } finally {
      setPending((current) => new Set([...current].filter((key) => key !== id)));
    }
  };

  const revoke = async (agent: string): Promise<void> => {
    const line = folds().get(agent);

    if (!line || line.verdict !== "project" || line.removed || revokes().has(agent) || daemonExit() !== null) return;

    setRevokes((current) => new Set(current).add(agent));

    try {
      await app.rpc("decision.revoke", { id: line.id, proof: await app.daemonProof() });

      if (folds().get(agent) === line) unfold(agent);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (folds().get(agent) === line) {
        if (thrown instanceof RpcError && thrown.code === -32001) {
          setRevokeFailures((current) => new Map([...current].filter(([key]) => key !== agent)));
          setFolds((current) => new Map(current).set(agent, { ...line, removed: true }));
        } else setRevokeFailures((current) => new Map(current).set(agent, thrown.message));
      }
    } finally {
      setRevokes((current) => new Set([...current].filter((key) => key !== agent)));
    }
  };

  return {
    folded: (agent) => agent === null ? undefined : folds().get(agent),
    dismiss: unfold,
    dismissFailure,
    dismissRevokeFailure: agent => setRevokeFailures(current => new Map([...current].filter(([key]) => key !== agent))),
    revoke,
    revoking: (agent) => revokes().has(agent),
    revokeFailure: (agent) => revokeFailures().get(agent) ?? null,
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
    answerFailure: (id) => {
      const failure = failures().get(id);

      return failure?.message ?? null;
    },
    answer,
  };
};
