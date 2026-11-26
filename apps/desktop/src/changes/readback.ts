import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { Account } from "@contracts/agent/Account";
import type { DiagramStop } from "@contracts/agent/DiagramStop";
import type { Gap } from "@contracts/agent/Gap";
import type { Readback } from "@contracts/agent/Readback";
import type { ReadbackStartParams } from "@contracts/agent/ReadbackStartParams";
import type { Events } from "../app/events";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import { stopsOf } from "./diagram";
import type { Read } from "./flows";
import { reachKey, watchTurns, type Reach } from "./owned";
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

/** U7703b: where the stepper stands: the stops to step, the one lit, and the move, which asks the Daemon nothing. */
export type Stepper = { stops: () => readonly DiagramStop[]; at: () => number; go: (direction: 1 | -1) => void };

/**
 * U7688a, U7688b: the readback of the open comparison. `agent.readback` is read once the listing is ready, every second while it reads, when a turn that wrote ends and when the listing is read again; `agent.readbackStart` is asked only by `start`, the user's action (P9), and never while one reads.
 * A new `at` ends what ran: its answers are dropped. A comparison with no Worktree (`to` null) has no readback.
 */
export const createReadback = (input: { app: AppSeam; events: Events; id: string; at: () => Reach | null; ready: () => boolean }) => {
  const [state, setState] = createSignal<Readback>({ state: "notRead" });
  let generation = 0;
  let wrote = false;
  let begun = false;
  let listed = false;
  const [skills, setSkills] = createSignal<readonly string[]>([]);
  const [skill, setSkill] = createSignal<string | null>(null);
  const [stop, setStop] = createSignal(0);

  const ask = async (method: "agent.readback" | "agent.readbackStart") => {
    const at = untrack(input.at);
    const mine = generation;
    let answer: Readback | undefined;

    if (!at) return;

    const params: ReadbackStartParams = { id: input.id, ...at };
    const chosen = method === "agent.readbackStart" ? skill() : null;

    if (chosen !== null) params.skill = chosen;

    const failure = await failureOf(async () => { answer = await input.app.rpc(method, params); });

    if (mine === generation) setState(failure !== null || !answer ? { state: "failed", kind: "call", cause: failure ?? "no_answer" } : answer);
  };

  /** RS5: the names `agent.skills` lists for the Agent, read once and only to offer the picker. */
  const listSkills = async () => {
    if (listed) return;
    listed = true;
    await failureOf(async () => { setSkills((await input.app.rpc("agent.skills", { id: input.id })).skills.map(each => each.name)); });
  };

  createEffect(() => ({ to: reachKey(input.at()), ready: input.ready() }), ({ to, ready }) => {
    if (!to) {
      generation += 1;
      begun = false;
      setStop(0);
      setState({ state: "notRead" });
    } else if (ready && !begun) {
      begun = true;
      void ask("agent.readback");
      void listSkills();
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

  // U7703: the stops the account's diagram can light; the position is kept across a result that replaces the last while it reads, clamped to the new count.
  const stops = createMemo(() => {
    const each = account();

    return each ? stopsOf(each) : [];
  });

  const clamp = (position: number) => Math.min(Math.max(position, 0), Math.max(stops().length - 1, 0));
  const at = () => clamp(stop());
  const stepper: Stepper = { stops, at, go: direction => setStop(clamp(at() + direction)) };

  // U7689: the readback the lists are drawn from, and whether the diff has moved on since.
  const read = createMemo((): Read | undefined => {
    const each = account();

    return each && { account: each, stale: state().state === "stale" };
  });

  return {
    state,
    /** RS5: the Skills the user may brief the readback with, and the one picked (none until they pick). */
    skills,
    skill,
    pick: (name: string | null) => setSkill(name),
    account,
    read,
    /** The gaps a diff may draw: only a result that still matches the diff. */
    placed,
    /** U7703b: the diagram's stepper: it opens on the first stop, a new run starts there again and no step is a call. */
    stepper,
    available: () => input.at() !== null,
    /** U7689c: the user may start one: a comparison with a Worktree and no run yet. */
    offered: () => input.at() !== null && state().state === "notRead",
    /** The user asked: one run at a time, however many ask. */
    start: () => {
      if (!untrack(input.at) || state().state === "reading") return;
      generation += 1;
      setStop(0);
      setState({ state: "reading" });
      void ask("agent.readbackStart");
      // RS5: a pick is for one run; a new Overview opens with none.
      setSkill(null);
    },
    /** The listing was read again: the diff may have changed under the result. */
    again: () => { if (begun) void ask("agent.readback"); },
  };
};

export type ReadbackState = ReturnType<typeof createReadback>;
