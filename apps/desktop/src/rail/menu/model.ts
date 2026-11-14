import { alertLevel } from "../alertLevel";
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
import { goesLine, staysLine } from "./removal";
import { isMode } from "../layout";
import { railOrder } from "../../state/railTopology";
import { judgeRemoval } from "./removal";
import type { Known, Removal } from "./removal";
import { contextMenu, linkEntries } from "../../ui/contextMenu";
import type { MenuEntry } from "../../ui/contextMenu";
import { offered } from "./entries";
import type { Candidate } from "./entries";

/** What the Rail's confirm is about, with the data its answer needs. A removal's consequences are read before anything is asked. */
export type Confirming =
  | { kind: "stop"; node: RailNode; exit: ExitState | null }
  /** U367: `removal` is what removing a Workstream goes and stays, `"reading"` while it is read; an Agent has none. */
  | { kind: "remove"; node: RailNode; exit: ExitState | null; removal: Removal | "reading" | null; losses: string[]; removed?: (() => void) | undefined }
  | { kind: "reading-selection" }
  | { kind: "remove-selection"; nodes: [RailNode, ...RailNode[]]; summary: string; reversible: boolean; removed: () => void };

type Removing = Extract<Confirming, { kind: "remove" }>;

type Selecting = Extract<Confirming, { kind: "remove-selection" }>;

type RailMenuDeps = {
  app: AppSeam;
  rail: RailState;
  onFailure: (message: string, item?: string) => void;
  acknowledge: (item: string) => void;
  storage: ConnectedProject["drafts"];
  rename: (id: string) => void;
  queue: QueueView;
  extra: (node: RailNode) => MenuEntry[];
  feedback: (id: string) => ReturnType<typeof createCopyFeedback> | undefined;
  known: () => Known | null;
};

const NOT_FOUND = -32001;

/** U68: an Agent runs while its Terminal does, whatever its Kind; a Workstream keeps U56's Kind rule. */
const isRunning = (node: RailNode, exit: ExitState | null) =>
  node.kind !== "group" && exit === null && (node.kind === "agent" ? true : node.status?.kind !== "done");

const needsConfirmation = (node: RailNode, exit: ExitState | null) =>
  isRunning(node, exit) &&
  (node.status?.kind === "working" || node.status?.kind === "needs-you" || node.status?.kind === "blocked");

export const createRailMenu = ({ app, rail, onFailure, acknowledge, storage, rename, queue, extra, feedback, known }: RailMenuDeps) => {
  const [state, setState] = createSignal<Confirming | null>(null);
  let removingSelection = false;
  const resuming = new Set<string>();
  const [restarts, setRestarts] = createStore<Record<string, { request: string; pending: boolean } | undefined>>({});

  const lossesOf = (chosen: readonly RailNode[]) => chosen.flatMap(node => [
    ...(node.worktree ? [copy.removeWorktreeLoss(node.name)] : []),
    ...((node.terminal_id !== null && rail.exitOf(node) === null) || rail.terminals().some(t => t.running && t.owner === node.id) ? [copy.removeProcessLoss(node.name)] : []),
  ]);

  const restartMode = async (id: string, request = restarts[id]?.request ?? crypto.randomUUID()): Promise<{ kind: "acknowledged" | "pending" } | { kind: "failed" | "unknown"; message: string }> => {
    if (restarts[id]?.pending) return { kind: "pending" };
    setRestarts(id, { request, pending: true });
    const release = rail.launch(id);

    try {
      await app.rpc("agent.restartMode", { id, request });
      await rail.refresh({ terminals: true });
      setRestarts(id, undefined);
      acknowledge(id);

      return { kind: "acknowledged" };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      rail.commandFailure.show(error.message, id, "rail", () => { void restartMode(id); });

      return { kind: outcomeOf(error), message: error.message };
    } finally {
      if (restarts[id]) setRestarts(id, { request, pending: false });
      release();
    }
  };

  const close = () => {
    setState(null);
  };

  /** U2694g: pointer menus address their row without activating it. */
  const open = (node: RailNode, exit: ExitState | null, x: number, y: number, removed?: () => void, more: MenuEntry[] = []) => {
    return contextMenu(app, [...entries(node, exit, removed), ...more], x, y);
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

  /** One stop path: the menu's item, the Rail's icon and the confirm's answer all end here. */
  const stopNow = (node: RailNode) => {
    // U5991a: the row shows stopped now; the Daemon's reply or failure lifts the drawing.
    const lift = rail.drawExit(node.id, { kind: "signal" });

    void attempt(async () => { try { await app.rpc("agent.stop", { id: node.id }); await rail.refresh({ terminals: true }); } finally { lift(); } }, node.id);
  };

  /** U428: the Rail's stop icon. A `working`, `needs-you` or `blocked` Agent asks first, any other running Agent stops at once. */
  const requestStop = (node: RailNode, exit: ExitState | null) => {
    if (state() !== null) return;

    if (needsConfirmation(node, exit)) setState({ kind: "stop", node, exit });
    else stopNow(node);
  };

  const resume = async (id: string) => {
    if (resuming.has(id)) return;

    resuming.add(id);
    const release = rail.launch(id);
    // U5991a: the row shows running now; the refresh or a failure lifts the drawing.
    const lift = rail.drawExit(id, null);

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
      lift();
      resuming.delete(id);
      release();
    }
  };

  const isResumable = (node: RailNode, exit: ExitState | null) => node.can_resume && !isRunning(node, exit);

  const remove = (current: Removing, scope: "this" | "all") =>
    attempt(async () => {
      const result = await applying(() => app.rpc("rail.remove", scope === "all" ? { id: current.node.id, scope } : { id: current.node.id }));

      if (result.kind === "refused") throw result.error;

      if (result.kind === "pending") rail.keepAsked(current.node.id, { kind: "remove" });
      else current.removed?.();
    }, current.node.id);

  /** U5991a: the rows leave at once; the call, its receipt and a failure's return of the rows follow in the queue. */
  const removeAtOnce = (ids: string[], name: string, row: string, removed: (() => void) | undefined, leaving: string[] = ids) => {
    removed?.();
    rail.hide(leaving);
    close();

    void storage.undo.removeRailSelection(ids, name, "rail").then(async done => {
      if (done) {
        rail.keepRemoved(leaving);
        await rail.refresh();
        rail.unhide(leaving);
        acknowledge(row);
      } else {
        // The row returns first: a failure line about a row the Rail does not show would clear itself.
        rail.unhide(leaving);
        const failure = storage.undo.failure();

        if (failure) onFailure(failure, row);
      }
    });
  };

  const judge = async (current: Removing) => {
    setState(current);

    try {
      const removal = current.node.kind === "workstream" ? await judgeRemoval(app, rail.nodes, current.node.id, new Set(), known()) : null;
      const chosen = [current.node, ...rail.nodes.filter(node => removal?.removedIds.includes(node.id))];

      const losses = lossesOf(chosen);

      if (state() !== current) return;

      if (losses.length || removal?.unread.length) {
        setState({ ...current, removal, losses });

        return;
      }

      // Clean: the Workstream and what goes with it leave now; Agents that stay keep their rows.
      removeAtOnce([current.node.id], current.node.name, current.node.id, current.removed, [current.node.id, ...(removal?.removedIds ?? [])]);
    } catch (error) {
      close();

      if (error instanceof Error) onFailure(error.message, current.node.id);
      else throw error;
    }
  };

  /** Menu and key capture the same row before consequence judgement. */
  const requestRemove = (node: RailNode, exit: ExitState | null, removed?: () => void) => {
    if (state() !== null) return;
    void judge({ kind: "remove", node: { ...node }, exit, removal: "reading", losses: [], removed });
  };

  const removeSelection = async (current: Selecting) => {
    if (removingSelection) return;
    removingSelection = true;
    const row = current.nodes[0].id;

    try {
      const ids = current.nodes.map(node => node.id);

      if (!current.reversible) {
        const result = await applying(() => app.rpc("rail.removeSelection", { ids }));

        if (result.kind === "refused") throw result.error;

        if (result.kind === "pending") {
          for (const id of ids) rail.keepAsked(id, { kind: "remove" });
        } else current.removed();
      } else {
        removeAtOnce(ids, current.nodes.map(node => node.name).join(", "), row, current.removed);

        return;
      }

      acknowledge(row);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      onFailure(error.message, row);
    } finally { close(); removingSelection = false; }
  };

  const requestRemoveSelection = async (nodes: RailNode[], removed: () => void) => {
    if (state() !== null || removingSelection) return;
    const ids = new Set(nodes.map(node => node.id));
    const [first, ...rest] = nodes.map(node => ({ ...node }));

    if (!first) return;
    const chosen: Selecting["nodes"] = [first, ...rest];
    const reading: Confirming = { kind: "reading-selection" };
    setState(reading);

    try {
      const judgments = await Promise.all(chosen.flatMap(node => node.kind === "workstream" ? [judgeRemoval(app, rail.nodes, node.id, ids, known()).then(removal => ({ node, removal }))] : []));
      const affected = new Set([...chosen.map(node => node.id), ...judgments.flatMap(({ removal }) => removal.removedIds)]);

      const losses = lossesOf(railOrder(rail.nodes).filter(node => affected.has(node.id)));

      const summary = [chosen.map(node => node.name).join("\n"), ...judgments.flatMap(({ node, removal }) => [goesLine(removal, node.name), staysLine(removal), ...removal.unread.map(list => copy.listUnread(list))]), ...losses].filter(Boolean).join("\n");
      const unread = judgments.flatMap(({ removal }) => removal.unread);

      if (state() === reading) setState({ kind: "remove-selection", nodes: chosen, removed, summary, reversible: losses.length === 0 && unread.length === 0 });
    } catch (error) {
      close();

      if (!(error instanceof Error)) throw error;
      onFailure(error.message, first.id);
    }
  };

  /** The answer to the open confirm: each kind of question has its own call. */
  const confirm = (scope: "this" | "all") => {
    const current = state();

    if (current === null) return;

    switch (current.kind) {
      case "stop": return stopNow(current.node);
      case "remove": return remove(current, scope);
      case "remove-selection": return removeSelection(current);
      case "reading-selection": return;
    }
  };

  /** U2694d: `agent.resume {id, mode}` restarts the same session, running or exited; a failure shows U80's line. */
  const restart = async (node: RailNode, mode: "normal" | "yolo") => {
    const release = rail.launch(node.id);

    try {
      await app.rpc("agent.resume", { id: node.id, mode });
      await rail.refresh();
      acknowledge(node.id);
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;

      onFailure(error.message, node.id);

      if (error.code === NOT_FOUND) await rail.refresh();
    } finally {
      release();
    }
  };

  /** A5214a: `agent.makeWorkstream`; the row then shows as a Workstream, or the Daemon's message shows. */
  const makeWorkstream = (node: RailNode) =>
    attempt(async () => {
      await app.rpc("agent.makeWorkstream", { id: node.id });
      await rail.refresh({ terminals: true });
    }, node.id);

  const alertsEntry = (node: RailNode): MenuEntry => ({
    id: "alerts", label: copy.alerts,
    children: (["all", "default", "quiet"] as const).map(level => ({
      id: `alerts:${level}`, label: copy.alertLevels[level], checked: alertLevel(rail.nodes, node) === level,
      run: async () => {
        try {
          const ping = await app.rpc("daemon.ping", null);
          await app.rpc("rail.setAlertLevel", { project: ping.project, id: node.id, level });
          await rail.refresh();
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          onFailure(error.message, node.id);
        }
      },
    })),
  });

  const renameEntry = (node: RailNode): MenuEntry => ({ id: "rename", label: copy.rename, shortcut: copy.renameChord, run: () => rename(node.id) });

  /** A queued row offers the Queue's own choices; each is one call, and a failure shows as any row action's. */
  const queuedEntries = (node: RailNode, { place, of }: { place: number; of: number }): Candidate[] => {
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
      { when: place > 1, id: "move-up", label: copy.moveUp, run: call(async () => { await app.rpc("workstream.queueMove", { workstream: node.id, index: place - 2 }); }) },
      { when: place < of, id: "move-down", label: copy.moveDown, run: call(async () => { await app.rpc("workstream.queueMove", { workstream: node.id, index: place }); }) },
    ];
  };

  const lifecycleEntries = (node: RailNode, exit: ExitState | null): Candidate[] => {
    const running = isRunning(node, exit);

    return [
      renameEntry(node),
      { when: node.yolo && !isMode(node) && running, id: "restart", label: copy.restart, run: () => restart(node, "normal") },
      // A5213: the Daemon takes `mode` for a live row, or an exited one holding a saved conversation.
      { when: !node.yolo && (running || node.can_resume), id: "yolo", label: copy.startYolo, run: () => restart(node, "yolo") },
      { when: running, id: "stop", label: copy.stop, run: () => requestStop(node, exit) },
      { when: isResumable(node, exit), id: "resume", label: copy.resume, run: () => {
        rail.select(node.id);

        return resume(node.id);
      } },
    ];
  };

  /** U2694b: a row's items in the table's order; a Group (a Workstream with no Agent at it) offers Rename and the extras only. */
  const entries = (node: RailNode, exit: ExitState | null, removed?: () => void): MenuEntry[] => {
    if (node.kind === "group") return [renameEntry(node), ...extra(node)];

    const remove: MenuEntry = { id: "remove", label: copy.remove, shortcut: "⇧⌘⌫", run: () => requestRemove(node, exit, removed) };
    const queued = node.kind === "workstream" ? queue.entryOf(node.id) : null;

    if (queued) return offered([...queuedEntries(node, queued), ...extra(node), alertsEntry(node), remove]);

    if (node.kind === "workstream" && node.attempt === null) return [...extra(node), alertsEntry(node), remove];

    return offered([
      ...lifecycleEntries(node, exit),
      alertsEntry(node),
      ...extra(node),
      ...linkEntries(app, { kind: node.kind, id: node.id }, rail.nodes, (candidate) => isRunning(candidate, rail.exitOf(candidate)), (message) => onFailure(message, node.id), () => acknowledge(node.id), feedback(node.id)),
      remove,
    ]);
  };

  return {
    confirming: state,
    open,
    close,
    confirm,
    requestRemove,
    requestRemoveSelection,
    restartMode,
    makeWorkstream,
    restartPending: (id: string) => restarts[id]?.pending ?? false,
    requestStop,
    isRunning,
    requestResume: (node: RailNode) => void resume(node.id),
    isResumable,
  };
};

export type RailMenuModel = ReturnType<typeof createRailMenu>;
