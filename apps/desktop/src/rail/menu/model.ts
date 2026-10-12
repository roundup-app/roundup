import { createSignal } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { RpcError } from "../../app/seam";
import type { AppSeam } from "../../app/seam";
import { clearingOf } from "../../thread/clear";
import type { Events } from "../../app/events";
import type { ExitState, RailState } from "../../state/rail";
import { createChoices } from "../../models/choices";
import { judgeRemoval } from "./removal";
import type { Removal } from "./removal";

type MenuState = {
  node: RailNode;
  exit: ExitState | null;
  x: number;
  y: number;
  confirming: boolean;
  /** U428: the confirm is for stopping the Agent, not for removing it. */
  stopping?: boolean;
  removed?: (() => void) | undefined;
  /** U367: what removing a Workstream goes and stays, once read; `null` while it is read. */
  removal?: Removal | null;
};

/** U378: the row menu's `model…` stage: the selects, then the one confirm. */
type Pair = { model: string | null; effort: string | null };

type ModelStage = "picking" | "confirming";

const NOT_FOUND = -32001;

const UNKNOWN_OUTCOME = -32004;

/** U68: an Agent runs while its Terminal does, whatever its Kind; a Workstream keeps U56's Kind rule. */
const isRunning = (node: RailNode, exit: ExitState | null) =>
  exit === null && (node.kind === "agent" ? true : node.status?.kind !== "done");

const needsConfirmation = ({ node, exit }: MenuState) =>
  isRunning(node, exit) &&
  (node.status?.kind === "working" || node.status?.kind === "needs-you" || node.status?.kind === "blocked");

export const createRailMenu = (app: AppSeam, rail: RailState, onFailure: (message: string) => void, events: Events) => {
  const [state, setState] = createSignal<MenuState | null>(null);
  const resuming = new Set<string>();
  const choices = createChoices(app);
  const [stage, setStage] = createSignal<ModelStage | null>(null);
  const [pair, setPair] = createSignal<Pair>({ model: null, effort: null });

  const close = () => {
    setStage(null);
    setState(null);
  };

  const open = (node: RailNode, exit: ExitState | null, x: number, y: number, removed?: () => void) => {
    rail.select(node.id);
    setStage(null);
    setState({ node, exit, x, y, confirming: false, removed });
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

  /** U428: the one stop path of the menu's `stop` and the Rail row's stop icon: a `working`, `needs-you` or `blocked` Agent asks first, any other running Agent stops at once. */
  const chooseStop = () => {
    const current = state();

    if (!current) return;

    if (!current.confirming && needsConfirmation(current)) {
      setState({ ...current, confirming: true, stopping: true });

      return;
    }

    void attempt(async () => { await stop(current.node); });
  };

  const requestStop = (node: RailNode, exit: ExitState | null, x: number, y: number) => {
    open(node, exit, x, y);
    chooseStop();
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

        if (rail.failure() !== null) onFailure("Resume outcome unknown: The Daemon may have resumed it");
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

  /** U350: the same word as the Thread header's, only for a Workstream and not while its clear is pending. */
  const canClearNode = (node: RailNode) => node.kind === "workstream" && clearingOf(app, events, node.id).phase() === "closed";

  const canClear = (current: MenuState) => canClearNode(current.node);

  const clearNode = (node: RailNode) => clearingOf(app, events, node.id).open();

  const chooseClear = () => {
    const current = state();

    close();

    if (current) clearNode(current.node);
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

  /** U378: `model…` opens the two selects at the Agent's own pair. */
  const chooseModel = () => {
    const current = state();

    if (!current) return;

    setPair({ model: current.node.model, effort: current.node.effort });
    setStage("picking");
    void choices.load();
  };

  const changed = (current: MenuState) => pair().model !== current.node.model || pair().effort !== current.node.effort;

  /** `apply` opens the one confirm; `change` calls `agent.setModel` once with `confirmed: true`. */
  const apply = () => {
    const current = state();

    if (current && changed(current)) setStage("confirming");
  };

  const change = () => {
    const current = state();
    const next = pair();

    if (current) void attempt(async () => {
      await app.rpc("agent.setModel", { id: current.node.id, ...next, confirmed: true });
      await rail.refresh();
    });
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
    requestStop,
    chooseClear,
    canClear,
    canClearNode,
    clearNode,
    requestRemove,
    chooseResume,
    chooseModel,
    apply,
    change,
    choices,
    stage,
    pair,
    setPair,
    canApply: (current: MenuState) => changed(current),
    /** U378: a running Door is its Workstream row; a Workstream with no live Agent has nothing to change. */
    canModel: (current: MenuState) => current.node.kind === "agent" || (current.node.terminal_id !== null && isRunning(current.node, current.exit)),
    canStop: (current: MenuState) => isRunning(current.node, current.exit),
    /** U428: whether the row has a running Agent to stop. */
    isRunning,
    canResume: (current: MenuState) => current.node.can_resume && !isRunning(current.node, current.exit),
  };
};

export type RailMenuModel = ReturnType<typeof createRailMenu>;
