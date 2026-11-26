import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Account } from "@contracts/agent/Account";
import type { Gap } from "@contracts/agent/Gap";
import type { Readback } from "@contracts/agent/Readback";
import type { Events } from "../app/events";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import type { Read } from "./flows";
import { watchTurns } from "./owned";
import type { Span } from "./repeats";

/** U7688b: how long a running readback waits before the App reads its state again: the Daemon emits no event when a run ends. */
const POLL_MS = 1000;

const NONE: readonly Gap[] = [];

/** U7688b: the account of a read or stale result, else none. */
export const accountOf = (state: Readback): Account | undefined => state.state === "read" || state.state === "stale" ? state : undefined;

/** U7688e: the gaps of an account whose comparison succeeded; a failed comparison holds none. */
export const gapsOf = (account: Account | undefined): readonly Gap[] => account && Array.isArray(account.gaps) ? account.gaps : NONE;

/** U7688c: why the comparison with the Agent's last message failed, when it did (RB4). */
export const gapsFailure = (account: Account): string | undefined => Array.isArray(account.gaps) ? undefined : account.gaps.failed;

/** U7688b: the cause of a failed readback. */
export const failureCause = (state: Readback): string | undefined => state.state === "failed" ? state.cause : undefined;

/** U7688e: the place a gap points at, one line of its file's new side. */
export const spanOf = (gap: Gap): Span => ({ path: gap.path, start: gap.line, end: gap.line });

/**
 * U7688a, U7688b: the readback of the open comparison. `agent.readback` is read once the listing is ready, every second while it reads, when a turn that wrote ends and when the listing is read again; `agent.readbackStart` is asked only by `start`, the user's action (P9), and never while one reads.
 * A new `to` ends what ran: its answers are dropped. A comparison with no Worktree (`to` null) has no readback.
 */
export const createReadback = (input: { app: AppSeam; events: Events; id: string; to: () => "tree" | "branch" | null; ready: () => boolean }) => {
  const [state, setState] = createSignal<Readback>({ state: "notRead" });
  let generation = 0;
  let wrote = false;
  let begun = false;

  const ask = async (method: "agent.readback" | "agent.readbackStart") => {
    const to = input.to();
    const mine = generation;
    let answer: Readback | undefined;

    if (!to) return;

    const failure = await failureOf(async () => { answer = await input.app.rpc(method, { id: input.id, to }); });

    if (mine === generation) setState(failure !== null || !answer ? { state: "failed", kind: "call", cause: failure ?? "no_answer" } : answer);
  };

  createEffect(() => ({ to: input.to(), ready: input.ready() }), ({ to, ready }) => {
    if (!to) {
      generation += 1;
      begun = false;
      setState({ state: "notRead" });
    } else if (ready && !begun) {
      begun = true;
      void ask("agent.readback");
    }
  });

  createEffect(() => state().state === "reading", reading => {
    if (!reading) return undefined;

    const timer = setInterval(() => void ask("agent.readback"), POLL_MS);

    return () => clearInterval(timer);
  });

  onCleanup(watchTurns(input.events, input.id, {
    wrote: () => { wrote = true; },
    ended: () => { if (wrote && begun) void ask("agent.readback"); wrote = false; },
  }));

  const account = createMemo(() => accountOf(state()));
  const placed = createMemo(() => state().state === "read" ? gapsOf(account()) : NONE);

  // U7689: the readback the lists are drawn from, and whether the diff has moved on since.
  const read = createMemo((): Read | undefined => {
    const each = account();

    return each && { account: each, stale: state().state === "stale" };
  });

  return {
    state,
    account,
    read,
    /** The gaps a diff may draw: only a result that still matches the diff. */
    placed,
    available: () => input.to() !== null,
    /** U7689c: the user may start one: a comparison with a Worktree and no run yet. */
    offered: () => input.to() !== null && state().state === "notRead",
    /** The user asked: one run at a time, however many ask. */
    start: () => {
      if (!input.to() || state().state === "reading") return;
      generation += 1;
      setState({ state: "reading" });
      void ask("agent.readbackStart");
    },
    /** The listing was read again: the diff may have changed under the result. */
    again: () => { if (begun) void ask("agent.readback"); },
  };
};

export type ReadbackState = ReturnType<typeof createReadback>;
