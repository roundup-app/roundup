import type { createCopyFeedback } from "../../ui/CopyButton";
import type { ConnectedProject } from "../../state/connectedProject";
import { copy } from "../copy";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { RailNode } from "@contracts/agent/RailNode";
import { applying } from "../../app/pending";
import { outcomeOf, RpcError } from "../../app/seam";
import type { AppSeam } from "../../app/seam";
import type { ExitState, RailState } from "../../state/rail";
import type { QueueView } from "../../state/queue";
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
  removal?: Removal | null | undefined;
  losses?: string[];
};

const NOT_FOUND = -32001;

/** U68: an Agent runs while its Terminal does, whatever its Kind; a Workstream keeps U56's Kind rule. */
const isRunning = (node: RailNode, exit: ExitState | null) =>
  exit === null && (node.kind === "agent" ? true : node.status?.kind !== "done");

const needsConfirmation = ({ node, exit }: MenuState) =>
  isRunning(node, exit) &&
  (node.status?.kind === "working" || node.status?.kind === "needs-you" || node.status?.kind === "blocked");

export const createRailMenu = (app: AppSeam, rail: RailState, onFailure: (message: string, item?: string) => void, acknowledge: (item: string) => void, storage: ConnectedProject["drafts"], rename: (id: string) => void, queue: QueueView, extra: (node: RailNode) => MenuEntry[] = () => [], feedback: (id: string) => ReturnType<typeof createCopyFeedback> | undefined = () => undefined) => {
  const [state, setState] = createSignal<MenuState | null>(null);
  const resuming = new Set<string>();
  const [restarts, setRestarts] = createStore<Record<string, { request: string; pending: boolean } | undefined>>({});

  const restartSession = async (id: string, request = restarts[id]?.request ?? crypto.randomUUID()): Promise<{ kind: "acknowledged" | "pending" } | { kind: "failed" | "unknown"; message: string }> => {
    if (restarts[id]?.pending) return { kind: "pending" };
    setRestarts(id, { request, pending: true });

    try {
      await app.rpc("workstream.restart", { id, request });
      await rail.refresh({ terminals: true });
      setRestarts(id, undefined);
      acknowledge(id);

      return { kind: "acknowledged" };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      rail.commandFailure.show(error.message, id, "rail", () => { void restartSession(id); });

      return { kind: outcomeOf(error), message: error.message };
    } finally {
      if (restarts[id]) setRestarts(id, { request, pending: false });
    }
  };

  const close = () => {
    setState(null);
  };

  /** U2694g: pointer menus address their row without activating it. */
  const open = (node: RailNode, exit: ExitState | null, x: number, y: number, removed?: () => void) => {
    return contextMenu(app, entries(node, exit, removed), x, y);
  };

  const attempt = async (call: () => Promise<void>, item?: string) => {
    close();

    try {
      await call();

      if (item !== undefined) acknowledge(item);
    } catch (error) {
      if (error instanceof RpcError && error.code === -32001) {
        await rail.refresh();
      } else if (error instanceof Error) {
        onFailure(error.message, item);
      } else {
        throw error;
      }
    }
  };

  const stop = (node: RailNode) => app.rpc("agent.stop", { id: node.id });

  /** One stop path: the menu's item and the Rail's icon both end here. */
  const chooseStop = () => {
    const current = state();

    if (current) void attempt(async () => { await stop(current.node); }, current.node.id);
  };

  /** U428: the Rail's stop icon. A `working`, `needs-you` or `blocked` Agent asks first, any other running Agent stops at once. */
  const requestStop = (node: RailNode, exit: ExitState | null) => {
    if (state()?.confirming) return;
    const current: MenuState = { node, exit, confirming: false, action: "stop" };
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
      acknowledge(id);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (outcomeOf(error) === "unknown") {
        await rail.refresh({ terminals: true });

        if (rail.failure() !== null) onFailure(copy.resumeOutcomeUnknownTheDaemonMayHaveResumed, id);
      } else {
        onFailure(error.message, id);

        if (error instanceof RpcError && error.code === NOT_FOUND) await rail.refresh();
      }
    } finally {
      resuming.delete(id);
    }
  };

  const isResumable = (node: RailNode, exit: ExitState | null) => node.can_resume && !isRunning(node, exit);

  const chooseRemove = (scope: "this" | "all" = "this") => {
    const current = state();

    if (!current) return;

    if (current.confirming) return remove(current, scope);
    void judge(current);
  };

  const remove = (current: MenuState, scope: "this" | "all") =>
    attempt(async () => {
      const result = await applying(() => app.rpc("rail.remove", scope === "all" ? { id: current.node.id, scope } : { id: current.node.id }));

      if (result.kind === "refused") throw result.error;

      if (result.kind === "pending") rail.keepAsked(current.node.id, { kind: "remove" });
      else current.removed?.();
    }, current.node.id);

  const judge = async (current: MenuState) => {
    setState({ ...current, confirming: true, removal: null });

    try {
      const removal = current.node.kind === "workstream" ? await judgeRemoval(app, rail.nodes, current.node.id) : undefined;
      const chosen = [current.node, ...rail.nodes.filter(node => removal?.removedIds.includes(node.id))];

      const losses = chosen.flatMap(node => [
        ...(node.worktree ? [copy.removeWorktreeLoss(node.name)] : []),
        ...((node.terminal_id !== null && rail.exitOf(node) === null) || rail.terminals().some(t => t.running && t.owner === node.id) ? [copy.removeProcessLoss(node.name)] : []),
      ]);

      if (state()?.node.id !== current.node.id) return;

      if (losses.length) {
        setState({ ...current, confirming: true, removal, losses });

        return;
      }

      const removed = await storage.todoUndo.removeRail(current.node.id, current.node.name, "rail");
      close();

      if (removed) {
        current.removed?.();
        acknowledge(current.node.id);
      } else if (storage.todoUndo.failure() && !storage.todoUndo.blocked()) onFailure(storage.todoUndo.failure()!, current.node.id);
    } catch (error) {
      close();

      if (error instanceof Error) onFailure(error.message, current.node.id);
      else throw error;
    }
  };

  /** Menu and key capture the same row before consequence judgement. */
  const requestRemove = (node: RailNode, exit: ExitState | null, removed?: () => void) => {
    if (state()?.confirming) return;
    setState({ node: { ...node }, exit, confirming: false, action: "remove", removed });
    chooseRemove();
  };

  /** U2694d: `agent.resume {id, mode}` restarts the same session, running or exited; a failure shows U80's line. */
  const restart = async (node: RailNode, mode: "normal" | "yolo") => {
    try {
      await app.rpc("agent.resume", { id: node.id, mode });
      await rail.refresh();
      acknowledge(node.id);
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;

      onFailure(error.message, node.id);

      if (error.code === NOT_FOUND) await rail.refresh();
    }
  };

  /** U2694b: a row's items in the table's order; a Group (a Workstream with no Agent at it) offers Remove only. */
  const entries = (node: RailNode, exit: ExitState | null, removed?: () => void): MenuEntry[] => {
    const remove: MenuEntry = { id: "remove", label: copy.remove, shortcut: "⌘⌫", run: () => requestRemove(node, exit, removed) };

    const queued = node.kind === "workstream" ? queue.entryOf(node.id) : null;

    if (queued) {
      // a queued row offers the Queue's own choices; each is one call, and a failure shows as any row action's.
      const call = (run: () => Promise<void>) => async () => {
        try {
          await run();
          acknowledge(node.id);
        } catch (error) {
          if (!(error instanceof Error)) throw error;

          onFailure(error.message, node.id);
        }

        await queue.refresh();
      };

      return [
        { id: "start-now", label: copy.startNow, run: call(async () => { await app.rpc("workstream.startNow", { workstream: node.id }); }) },
        { id: "dequeue", label: copy.takeOutOfQueue, run: call(async () => { await app.rpc("workstream.dequeue", { workstream: node.id }); }) },
        ...(queued.place > 1 ? [{ id: "move-up", label: copy.moveUp, run: call(async () => { await app.rpc("workstream.queueMove", { workstream: node.id, index: queued.place - 2 }); }) }] : []),
        ...(queued.place < queued.of ? [{ id: "move-down", label: copy.moveDown, run: call(async () => { await app.rpc("workstream.queueMove", { workstream: node.id, index: queued.place }); }) }] : []),
        ...extra(node),
        remove,
      ];
    }

    if (node.kind === "workstream" && node.attempt === null) return [...extra(node), remove];

    const items: MenuEntry[] = [
      { id: "rename", label: copy.rename, shortcut: copy.renameChord, run: () => rename(node.id) },
    ];

    if (node.yolo && !(node.kind === "workstream" && node.opening_prompt?.trim()) && isRunning(node, exit)) items.push({ id: "restart", label: copy.restart, run: () => restart(node, "normal") });

    // A5213: the Daemon takes `mode` for a live row, or an exited one holding a saved conversation.
    if (!node.yolo && (isRunning(node, exit) || node.can_resume)) items.push({ id: "yolo", label: copy.startYolo, run: () => restart(node, "yolo") });

    if (isRunning(node, exit)) items.push({ id: "stop", label: copy.stop, run: () => requestStop(node, exit) });

    if (isResumable(node, exit)) items.push({ id: "resume", label: copy.resume, run: () => {
      rail.select(node.id);

      return resume(node.id);
    } });


    return [
      ...items,
      ...extra(node),
      ...linkEntries(app, { kind: node.kind, id: node.id }, rail.nodes, (candidate) => isRunning(candidate, rail.exitOf(candidate)), (message) => onFailure(message, node.id), () => acknowledge(node.id), feedback(node.id)),
      remove,
    ];
  };

  return {
    state,
    open,
    close,
    chooseStop,
    chooseRemove,
    requestRemove,
    restartSession,
    restartPending: (id: string) => restarts[id]?.pending ?? false,
    requestStop,
    isRunning,
    requestResume: (node: RailNode) => void resume(node.id),
    isResumable,
  };
};

export type RailMenuModel = ReturnType<typeof createRailMenu>;
