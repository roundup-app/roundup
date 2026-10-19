import { copy } from "../../copy";
import { createSignal } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { RpcError } from "../../app/seam";
import type { AppSeam } from "../../app/seam";
import { clearingOf } from "../clear";
import type { Events } from "../../app/events";
import type { ExitState, RailState } from "../../state/rail";
import { judgeRemoval } from "./removal";
import type { Removal } from "./removal";

type MenuState = {
  node: RailNode;
  exit: ExitState | null;
  x: number;
  y: number;
  confirming: boolean;
  action: "stop" | "remove";
  removed?: (() => void) | undefined;
  /** U367: what removing a Workstream goes and stays, once read; `null` while it is read. */
  removal?: Removal | null;
};

const NOT_FOUND = -32001;

const UNKNOWN_OUTCOME = -32004;

/** U68: an Agent runs while its Terminal does, whatever its Kind; a Workstream keeps U56's Kind rule. */
const isRunning = (node: RailNode, exit: ExitState | null) =>
  exit === null && (node.kind === "agent" ? true : node.status?.kind !== "done");

const needsConfirmation = ({ node, exit }: MenuState) =>
  isRunning(node, exit) &&
  (node.status?.kind === "working" || node.status?.kind === "needs-you" || node.status?.kind === "blocked");

export const createRailMenu = (app: AppSeam, rail: RailState, onFailure: (message: string) => void, events: Events, project: string) => {
  const [state, setState] = createSignal<MenuState | null>(null);
  const resuming = new Set<string>();

  const close = () => {
    setState(null);
  };

  const open = (node: RailNode, exit: ExitState | null, x: number, y: number, removed?: () => void) => {
    rail.select(node.id);
    setState({ node, exit, x, y, confirming: false, action: "remove", removed });
  };

  const attempt = async (call: () => Promise<void>) => {
    close();

    try {
      await call();
    } catch (error) {
      if (error instanceof RpcError && error.code === -32001) {
        await rail.refresh();
      } else if (error instanceof Error) {
        onFailure(error.message);
      } else {
        throw error;
      }
    }
  };

  const stop = (node: RailNode) =>
    node.kind === "agent"
      ? app.rpc("agent.stop", { id: node.id })
      : node.terminal_id !== null
        ? app.rpc("terminal.kill", { id: node.terminal_id })
        : Promise.resolve(null);

  /** One stop path: the menu's item and the Rail's icon both end here. */
  const chooseStop = () => {
    const current = state();

    if (current) void attempt(async () => { await stop(current.node); });
  };

  /** U428: the Rail's stop icon. A `working`, `needs-you` or `blocked` Agent asks first, any other running Agent stops at once. */
  const requestStop = (node: RailNode, exit: ExitState | null, x: number, y: number) => {
    const current: MenuState = { node, exit, x, y, confirming: false, action: "stop" };
    setState(current);

    if (needsConfirmation(current)) setState({ ...current, confirming: true });
    else chooseStop();
  };

  const resume = async (id: string) => {
    if (resuming.has(id)) return;

    resuming.add(id);

    try {
      await app.rpc("agent.resume", { id });
      await rail.refresh();
    } catch (error) {
      if (!(error instanceof RpcError)) {
        if (error instanceof Error) onFailure(error.message);
        else throw error;
      } else if (error.code === UNKNOWN_OUTCOME) {
        await rail.refresh({ terminals: true });

        if (rail.failure() !== null) onFailure(copy.resumeOutcomeUnknownTheDaemonMayHaveResumed);
      } else {
        onFailure(error.message);

        if (error.code === NOT_FOUND) await rail.refresh();
      }
    } finally {
      resuming.delete(id);
    }
  };

  const chooseResume = () => {
    const current = state();

    close();

    if (current) void resume(current.node.id);
  };

  const isResumable = (node: RailNode, exit: ExitState | null) => node.can_resume && !isRunning(node, exit);

  /** U350: the Workstream whose reason prompt the Rail shows, opened from its row menu or its clear icon. */
  const [clearTarget, setClearTarget] = createSignal<RailNode | null>(null);

  /** U350: the same word as the former Thread header's, only for a Workstream and not while its clear is pending. */
  const isClearable = (node: RailNode) => {
    if (node.kind !== "workstream") return false;

    const phase = clearingOf(app, events, node.id, project).phase();

    return phase !== "pending" && (phase === "closed" || clearTarget()?.id !== node.id);
  };

  const canClear = (current: MenuState) => isClearable(current.node);

  const chooseClear = () => {
    const current = state();

    close();

    if (current) requestClear(current.node);
  };

  /** U427: the Rail's clear icon opens U350's reason prompt for the Workstream. */
  const requestClear = (node: RailNode) => {
    if (!isClearable(node)) return;

    setClearTarget(node);
    clearingOf(app, events, node.id, project).open();
  };

  const chooseRemove = () => {
    const current = state();

    if (!current) return;

    if (current.node.kind === "workstream") {
      if (!current.confirming) void confirmWorkstream(current);
      else if (current.removal) void remove(current);

      return;
    }

    if (!current.confirming && needsConfirmation(current)) {
      setState({ ...current, confirming: true });

      return;
    }

    void remove(current);
  };

  const remove = (current: MenuState) =>
    attempt(async () => {
      await app.rpc("rail.remove", { id: current.node.id });
      current.removed?.();
    });

  /** U367: a Workstream always asks, after reading the facts A34 judges. */
  const confirmWorkstream = async (current: MenuState) => {
    setState({ ...current, confirming: true, removal: null });

    try {
      const removal = await judgeRemoval(app, rail.nodes, current.node.id);

      if (state()?.node.id === current.node.id) setState({ ...current, confirming: true, removal });
    } catch (error) {
      close();

      if (error instanceof Error) onFailure(error.message);
      else throw error;
    }
  };

  /** U358: the row menu's `remove` without the pointer: the same confirm, the same `rail.remove`, then `removed` once the Daemon has answered. */
  const requestRemove = (node: RailNode, exit: ExitState | null, x: number, y: number, removed: () => void) => {
    open(node, exit, x, y, removed);
    chooseRemove();
  };

  return {
    state,
    open,
    close,
    chooseStop,
    chooseRemove,
    chooseClear,
    canClear,
    clearTarget,
    hideClear: () => setClearTarget(null),
    requestRemove,
    requestStop,
    requestClear,
    isClearable,
    isRunning,
    chooseResume,
    requestResume: (node: RailNode) => void resume(node.id),
    isResumable,
    canStop: (current: MenuState) => isRunning(current.node, current.exit),
    canResume: (current: MenuState) => isResumable(current.node, current.exit),
  };
};

export type RailMenuModel = ReturnType<typeof createRailMenu>;
