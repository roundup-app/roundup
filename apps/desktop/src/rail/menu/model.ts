import { createSignal } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { RpcError } from "../../app/seam";
import type { AppSeam } from "../../app/seam";
import type { ExitState, RailState } from "../../state/rail";
import { createChoices } from "../../models/choices";

type MenuState = { node: RailNode; exit: ExitState | null; x: number; y: number; confirming: boolean; removed?: (() => void) | undefined };

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

export const createRailMenu = (app: AppSeam, rail: RailState, onFailure: (message: string) => void) => {
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

  const chooseStop = () => {
    const current = state();

    if (current) void attempt(async () => { await stop(current.node); });
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

        if (rail.failure() !== null) onFailure("resume outcome unknown: the Daemon may have resumed it");
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

  const chooseRemove = () => {
    const current = state();

    if (!current) return;

    if (!current.confirming && needsConfirmation(current)) {
      setState({ ...current, confirming: true });

      return;
    }

    void attempt(async () => {
      await app.rpc("rail.remove", { id: current.node.id });
      current.removed?.();
    });
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
    canModel: (current: MenuState) => current.node.kind === "agent",
    canStop: (current: MenuState) => isRunning(current.node, current.exit),
    canResume: (current: MenuState) => current.node.can_resume && !isRunning(current.node, current.exit),
  };
};

export type RailMenuModel = ReturnType<typeof createRailMenu>;
