import { copy } from "../copy";
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
  /** Lists whose read failed (U5301a): their counts are unknown, not zero. */
  unread: ("todo" | "pad")[];
};

const FINISHED = new Set(["done", "error"]);

const below = (nodes: readonly RailNode[], id: string): RailNode[] =>
  nodes.filter((node) => node.parent === id).flatMap((child) => [child, ...below(nodes, child.id)]);

const unlanded = (state: WorktreeState): string | null =>
  state.ahead > 0 ? copy.unlandedWorkAhead(state.ahead) : state.dirty ? copy.unlandedWorkUncommittedChanges : null;

/** Reads what `rail.remove` of Workstream `id` will judge: its Agents by Status and Worktree, its Todos by `done`, its Pads by Home. Writes nothing. */
export const judgeRemoval = async (app: AppSeam, nodes: readonly RailNode[], id: string): Promise<Removal> => {
  const [todoRead, padRead] = await Promise.allSettled([app.rpc("todo.list", null), app.rpc("pad.list", null)]);
  const todos: Todo[] = todoRead.status === "fulfilled" ? todoRead.value : [];
  const pads: Pad[] = padRead.status === "fulfilled" ? padRead.value : [];
  const removal: Removal = { affectedIds: below(nodes, id).map(node => node.id), removedIds: [], goes: { agents: [], todos: 0, pads: 0 }, stays: { agents: [], todos: 0, pads: 0 }, unread: [...(todoRead.status === "rejected" ? ["todo" as const] : []), ...(padRead.status === "rejected" ? ["pad" as const] : [])] };
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

  removal.goes.pads += pads.filter((each: Pad) => each.home === id).length;

  return removal;
};

/** U4601: names precede counts; each scope's judgment is presented once. */
export const goesLine = ({ goes }: Removal, name: string) =>
  copy.goes([name, ...goes.agents, ...(goes.todos ? [copy.doneTodoCount(goes.todos)] : []), ...(goes.pads ? [copy.removalPadCount(goes.pads)] : [])].join(", "));

/** U4601: only work preserved by Remove this belongs in Stays. */
export const staysLine = ({ stays }: Removal) => {
  const list = [...stays.agents.map(agent => agent.name), ...(stays.todos ? [copy.openTodoCount(stays.todos)] : []), ...(stays.pads ? [copy.removalPadCount(stays.pads)] : [])].join(", ");

  return list === "" ? null : copy.staysRemoveThis(list);
};

/** The native question carries the plan and offers only distinct removal scopes. */
export const removalQuestion = (removal: Removal, name: string) => {
  const stays = staysLine(removal);

  const summary = {
    title: copy.removeWorkstreamQuestion(name),
    message: [goesLine(removal, name), stays, ...removal.unread.map(list => copy.listUnread(list))].filter(Boolean).join("\n"),
    cancelLabel: copy.cancel,
  };

  return stays
    ? { ...summary, thisLabel: copy.removeThis, allLabel: copy.removeAll }
    : { ...summary, okLabel: copy.remove };
};
