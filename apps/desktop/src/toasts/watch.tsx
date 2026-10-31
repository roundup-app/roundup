import type { ActivationSource } from "../keys/registry";
import { copy } from "./copy";
import type { Actor } from "@contracts/Actor";
import type { Kind } from "@contracts/Kind";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import type { Unsubscribe } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import { TodoHost } from "../todos/TodoDrawer";
import { PadHost } from "../pads/PadDrawer";
import type { Candidate } from "./queue";
import type { StateAlerts } from "../rail/stateAlerts";

const TITLE_CHARS = 60;

const cut = (text: string): string => (text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text);

const GONE = copy.thatIsGone;

const todoItem = (id: number) => `todo:${id}`;

const padItem = (name: string) => `pad:${name}`;

/** U410: the Events of one open Project that make a Toast, as Candidates. `select` is how a click reaches the Agent's row, `show` the Project's tab. */
export const watchProject = (connected: ConnectedProject, pushCandidate: (candidate: Candidate) => void, show: () => void, isActive: () => boolean, settleItem: (item: string) => void, alerts?: StateAlerts): Unsubscribe => {
  const { rail, events, app, drawer } = connected;
  const owned = (item: string) => JSON.stringify([connected.project.path, item]);
  const settle = (item: string) => settleItem(owned(item));
  const push = (candidate: Candidate) => pushCandidate({ ...candidate, key: owned(candidate.key), item: owned(candidate.item), project: connected.project.path });
  // The Kind each Agent last had, so a load or a repeat makes no Toast.
  const seen = new Map<string, Kind>(rail.nodes.flatMap((node) => (node.status ? [[node.id, node.status.kind] as const] : [])));

  const byAgent = (actor: Actor, item: string, line: string, open: Candidate["open"]): Candidate | null => {
    if (actor.kind !== "agent") return null;

    const node = rail.nodes.find((each) => each.id === actor.id);

    return {
      key: actor.id,
      item,
      kind: node?.status?.kind ?? "working",
      name: rail.nameOf(actor),
      line,
      selected: isActive() && rail.selected() === actor.id,
      open,
    };
  };

  const openAgent = (id: string) => () => {
    if (!rail.nodes.some((node) => node.id === id)) return GONE;

    show();
    rail.select(id);

    return null;
  };

  const openTodo = (id: number) => async (source: ActivationSource) => {
    let listed: Todo[] = [];

    try {
      listed = await app.rpc("todo.list", null);
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;

      return failure.message;
    }

    if (!listed.some((todo) => todo.id === id)) return GONE;

    show();
    drawer.open(() => <TodoHost id={id} />, source, { kind: "todo", project: connected.project.path });

    return null;
  };

  const openPad = (name: string) => async (source: ActivationSource) => {
    let listed: Pad[] = [];

    try {
      listed = await app.rpc("pad.list", null);
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;

      return failure.message;
    }

    if (!listed.some((pad) => pad.name === name)) return GONE;

    show();
    drawer.open(() => <PadHost name={name} />, source, { kind: "pad", project: connected.project.path });

    return null;
  };

  return events.subscribe((event) => {
    if (event.name === "agent.status") {
      const { id, status } = event.data;
      const before = seen.get(id);

      seen.set(id, status.kind);

      if (before === status.kind) return;

      const node = rail.nodes.find((each) => each.id === id);
      const selected = isActive() && rail.selected() === id;
      const raised = alerts?.changed({ key: owned(id), id, name: node?.name ?? id, kind: status.kind, selected });

      if (status.kind !== "needs-you" && status.kind !== "error") return;

      push({
        key: id,
        item: `agent:${id}`,
        kind: status.kind,
        name: node?.name ?? id,
        line: status.kind === "error" ? status.label : copy.needsYou,
        selected,
        silent: raised !== undefined && !raised.chime,
        open: openAgent(id),
      });
    } else if (event.name === "todo.deleted") {
      settle(todoItem(event.data.id));
    } else if (event.name === "pad.deleted") {
      settle(padItem(event.data.name));
    } else if (event.name === "todo.updated" && event.actor.kind === "user") {
      settle(todoItem(event.data.id));
    } else if (event.name === "pad.changed" && event.actor.kind === "user") {
      settle(padItem(event.data.name));
    } else if (event.name === "todo.updated" && event.data.creator.kind === "user") {
      const candidate = byAgent(event.actor, todoItem(event.data.id), copy.changedTodo(cut(event.data.title)), openTodo(event.data.id));

      if (candidate) push(candidate);
    } else if (event.name === "pad.changed" && event.actor.kind === "agent") {
      const name = event.data.name;
      const actor = event.actor;

      void app.rpc("pad.list", null).then(
        (pads) => {
          if (!pads.some((pad) => pad.name === name)) return;

          const candidate = byAgent(actor, padItem(name), copy.changedPad(cut(name)), openPad(name));

          if (candidate) push(candidate);
        },
        () => undefined,
      );
    }
  });
};
