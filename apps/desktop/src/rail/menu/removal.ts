import type { RailNode } from "@contracts/agent/RailNode";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { AppSeam } from "../../app/seam";

/** U367: an Agent that stays at the Project root, with the reason in words. */
export type Stay = { id: string; name: string; reason: string };

/** U367: what A34 removes and what it moves, read from the Rail, `agent.worktreeState`, the Todos and the Pads. */
export type RemovalPlan = {
  goes: { agents: string[]; todos: number; pads: number };
  stays: { agents: Stay[]; todos: number; pads: number };
};

const NAMES_SHOWN = 3;

const finished = (node: RailNode) => node.status?.kind === "done" || node.status?.kind === "error";

const reasonOf = (node: RailNode, state: WorktreeState | null): string | null => {
  if (!finished(node)) return "running";

  if (state === null) return null;

  if (state.ahead > 0) return `unlanded work: ${state.ahead} ahead`;

  if (state.dirty) return "unlanded work: uncommitted changes";

  return null;
};

const under = (nodes: readonly RailNode[], workstream: string): RailNode[] => {
  const family = new Set([workstream]);
  const found: RailNode[] = [];

  for (const node of nodes) {
    if (node.parent !== null && family.has(node.parent)) {
      family.add(node.id);

      if (node.kind === "agent") found.push(node);
    }
  }

  return found;
};

/** A34's judgement, read and never written. */
export const readRemovalPlan = async (app: AppSeam, nodes: readonly RailNode[], workstream: RailNode): Promise<RemovalPlan> => {
  const agents = under(nodes, workstream.id);

  const [states, todos, pads] = await Promise.all([
    Promise.all(
      agents.map((agent) => (agent.worktree !== null && finished(agent) ? app.rpc("agent.worktreeState", { id: agent.id }) : null)),
    ),
    app.rpc("todo.list", null),
    app.rpc("pad.list", null),
  ]);

  const goes: string[] = [];
  const stays: Stay[] = [];

  agents.forEach((agent, at) => {
    const reason = reasonOf(agent, states[at] ?? null);

    if (reason === null) goes.push(agent.name);
    else stays.push({ id: agent.id, name: agent.name, reason });
  });

  const kept = new Set(stays.map((stay) => stay.id));
  const ownPads = pads.filter((pad) => pad.home === workstream.id);
  const staying = ownPads.reduce((sum, pad) => sum + (pad.owner.kind === "agent" && kept.has(pad.owner.id) ? 1 : 0), 0);
  const ownTodos = todos.filter((todo) => todo.home === workstream.id);
  const open = ownTodos.reduce((sum, todo) => sum + (todo.done ? 0 : 1), 0);

  return {
    goes: { agents: goes, todos: ownTodos.length - open, pads: ownPads.length - staying },
    stays: { agents: stays, todos: open, pads: staying },
  };
};

const counts = (parts: [number, string][]) =>
  parts.flatMap(([count, label]) => (count > 0 ? [`${count} ${label}`] : [])).join(", ");

export const goesLine = (plan: RemovalPlan): string =>
  `goes: ${counts([[plan.goes.agents.length, "agents"], [plan.goes.todos, "done todos"], [plan.goes.pads, "pads"]]) || "nothing"}`;

/** `null` when nothing stays. */
export const staysLine = (plan: RemovalPlan): string | null => {
  const line = counts([[plan.stays.agents.length, "agents"], [plan.stays.todos, "open todos"], [plan.stays.pads, "pads"]]);

  return line === "" ? null : `stays at the project root: ${line}`;
};

/** The first names of the Agents that go, then `+ <n> more`. */
export const goingNames = (plan: RemovalPlan): string[] => {
  const names = plan.goes.agents;

  return names.length > NAMES_SHOWN ? [...names.slice(0, NAMES_SHOWN), `+ ${names.length - NAMES_SHOWN} more`] : names;
};
