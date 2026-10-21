import type { ConnectedProject } from "../../state/connectedProject";
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
import { contextMenu, linkEntries } from "../../ui/contextMenu";
import type { MenuEntry } from "../../ui/contextMenu";

type MenuState = {
  node: RailNode;
  exit: ExitState | null;
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

export const createRailMenu = (app: AppSeam, rail: RailState, onFailure: (message: string) => void, events: Events, storage: ConnectedProject["drafts"], rename: (id: string) => void) => {
  const [state, setState] = createSignal<MenuState | null>(null);
  const resuming = new Set<string>();

  const close = () => {
    setState(null);
  };

  /** U2694g: pointer menus address their row without activating it. */
  const open = (node: RailNode, exit: ExitState | null, x: number, y: number, removed?: () => void) => {
    return contextMenu(app, entries(node, exit, removed), x, y);
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

  const stop = (node: RailNode) => app.rpc("agent.stop", { id: node.id });

  /** One stop path: the menu's item and the Rail's icon both end here. */
  const chooseStop = () => {
    const current = state();

    if (current) void attempt(async () => { await stop(current.node); });
  };

  /** U428: the Rail's stop icon. A `working`, `needs-you` or `blocked` Agent asks first, any other running Agent stops at once. */
  const requestStop = (node: RailNode, exit: ExitState | null) => {
    const current: MenuState = { node, exit, confirming: false, action: "stop" };
    setState(current);

    if (needsConfirmation(current)) setState({ ...current, confirming: true });
    else chooseStop();
  };

  const resume = async (id: string) => {
    rail.select(id);

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

  const isResumable = (node: RailNode, exit: ExitState | null) => node.can_resume && !isRunning(node, exit);

  /** U350: the Workstream whose reason prompt the Rail shows, opened from its row menu or its clear icon. */
  const [clearTarget, setClearTarget] = createSignal<RailNode | null>(null);

  /** U350: the same word as the former Thread header's, only for a Workstream and not while its clear is pending. */
  const isClearable = (node: RailNode) => {
    if (node.kind !== "workstream") return false;

    const phase = clearingOf(app, events, node.id, storage).phase();

    return phase !== "pending" && (phase === "closed" || clearTarget()?.id !== node.id);
  };

  /** U427: the Rail's clear icon opens U350's reason prompt for the Workstream. */
  const requestClear = (node: RailNode) => {
    if (!isClearable(node)) return;

    setClearTarget(node);
    clearingOf(app, events, node.id, storage).open();
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
  const requestRemove = (node: RailNode, exit: ExitState | null, removed: () => void) => {
    setState({ node, exit, confirming: false, action: "remove", removed });
    chooseRemove();
  };

  /** U2694d: `agent.resume {id, mode}` restarts the same session, running or exited; a failure shows U80's line. */
  const restart = async (node: RailNode, mode: "normal" | "yolo") => {
    try {
      await app.rpc("agent.resume", { id: node.id, mode });
      await rail.refresh();
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;

      onFailure(error.message);

      if (error.code === NOT_FOUND) await rail.refresh();
    }
  };

  /** U2694b: a row's items in the table's order; a Group (a Workstream with no Agent at it) offers Remove only. */
  const entries = (node: RailNode, exit: ExitState | null, removed?: () => void): MenuEntry[] => {
    const remove: MenuEntry = { id: "remove", label: copy.remove, shortcut: "⌘⌫", run: () => {
      setState({ node, exit, confirming: false, action: "remove", removed });
      chooseRemove();
    } };

    if (node.kind === "workstream" && node.attempt === null) return [remove];

    const agents = rail.nodes;

    const items: MenuEntry[] = [
      { id: "rename", label: copy.rename, shortcut: copy.renameChord, run: () => rename(node.id) },
      { id: "restart", label: copy.restart, enabled: node.yolo, run: () => restart(node, "normal") },
      { id: "yolo", label: copy.startYolo, enabled: !node.yolo, run: () => restart(node, "yolo") },
      { id: "stop", label: copy.stop, enabled: isRunning(node, exit), run: () => requestStop(node, exit) },
      { id: "resume", label: copy.resume, enabled: isResumable(node, exit), run: () => resume(node.id) },
    ];

    if (node.kind === "workstream") items.push({ id: "clear", label: copy.clearMenu, enabled: isClearable(node), run: () => requestClear(node) });

    return [
      ...items,
      ...linkEntries(app, node.kind, node.id, agents, (candidate) => isRunning(candidate, rail.exitOf(candidate)), onFailure),
      remove,
    ];
  };

  return {
    state,
    open,
    close,
    chooseStop,
    chooseRemove,
    clearTarget,
    hideClear: () => setClearTarget(null),
    requestRemove,
    requestStop,
    requestClear,
    isClearable,
    isRunning,
    requestResume: (node: RailNode) => void resume(node.id),
    isResumable,
  };
};

export type RailMenuModel = ReturnType<typeof createRailMenu>;
