import { copy } from "../../copy";
import type { RailNode } from "@contracts/agent/RailNode";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import type { AppSeam } from "../../app/seam";

/** Why an Agent stays at the Project root when its Workstream goes (A34), in words. */
export type Stay = { name: string; reason: string };

/** A34's judgement of a Workstream, from the same facts: what goes, and what stays at the Project root. */
export type Removal = {
  /** Removed Agents and non-Agent containers, for irreversible-loss detection only. */
  removedIds: string[];
  affectedIds: string[];
  goes: { agents: string[]; todos: number; pads: number };
  stays: { agents: Stay[]; todos: number; pads: number };
};

const FINISHED = new Set(["done", "error"]);

const below = (nodes: readonly RailNode[], id: string): RailNode[] =>
  nodes.filter((node) => node.parent === id).flatMap((child) => [child, ...below(nodes, child.id)]);

const unlanded = (state: WorktreeState): string | null =>
  state.ahead > 0 ? copy.unlandedWorkAhead(state.ahead) : state.dirty ? copy.unlandedWorkUncommittedChanges : null;

/** Reads what `rail.remove` of Workstream `id` will judge: its Agents by Status and Worktree, its Todos by `done`, its Pads by owner. Writes nothing. */
export const judgeRemoval = async (app: AppSeam, nodes: readonly RailNode[], id: string): Promise<Removal> => {
  const [todos, pads] = await Promise.all([app.rpc("todo.list", null), app.rpc("pad.list", null)]);
  const removal: Removal = { affectedIds: below(nodes, id).map(node => node.id), removedIds: [], goes: { agents: [], todos: 0, pads: 0 }, stays: { agents: [], todos: 0, pads: 0 } };
  const staying = new Set<string>();

  for (const node of below(nodes, id)) {
    if (node.kind !== "agent") {
      removal.removedIds.push(node.id);
      continue;
    }

    const reason = !FINISHED.has(node.status?.kind ?? "")
      ? copy.running
      : node.worktree === null
        ? null
        : unlanded(await app.rpc("agent.worktreeState", { id: node.id }));

    if (reason === null) {
      removal.goes.agents.push(node.name);
      removal.removedIds.push(node.id);
    } else {
      removal.stays.agents.push({ name: node.name, reason });
      staying.add(node.id);
    }
  }

  for (const todo of todos.filter((each: Todo) => each.home === id)) {
    if (todo.done) removal.goes.todos += 1;
    else removal.stays.todos += 1;
  }

  for (const pad of pads.filter((each: Pad) => each.home === id)) {
    if (pad.owner.kind === "agent" && staying.has(pad.owner.id)) removal.stays.pads += 1;
    else removal.goes.pads += 1;
  }

  return removal;
};

const counts = (parts: [number, string][]) => parts.flatMap(([count, noun]) => (count > 0 ? [copy.counted(count, noun)] : [])).join(", ");

/** U367: the line of what goes, `Goes: Nothing` when nothing does. */
export const goesLine = ({ goes }: Removal) =>
  copy.goes(counts([[goes.agents.length, copy.agentNoun], [goes.todos, copy.doneTodos], [goes.pads, copy.pads]]) || copy.nothing);

/** U367: the line of what stays at the Project root; `null` when nothing does. */
export const staysLine = ({ stays }: Removal) => {
  const list = counts([[stays.agents.length, copy.agentNoun], [stays.todos, copy.openTodoNoun], [stays.pads, copy.pads]]);

  return list === "" ? null : copy.staysAtTheProjectRoot(list);
};

/** U4461: the extra destruction authorized only by Remove all. */
export const removeAllLine = ({ stays }: Removal) => {
  const list = counts([[stays.agents.length, copy.agentNoun], [stays.todos, copy.openTodoNoun], [stays.pads, copy.pads]]);
  return list === "" ? null : copy.removeAllAlsoRemoves(list);
};

/** U367: the names of the Agents that go, one line each, then `+ <n> more`. */
export const goingNames = ({ goes }: Removal, shown = 5) => [
  ...goes.agents.slice(0, shown),
  ...(goes.agents.length > shown ? [copy.moreAgents(goes.agents.length - shown)] : []),
];
