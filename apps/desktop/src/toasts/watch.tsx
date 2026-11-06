import { appSettings } from "../settings/preferences";
import { createEffect, createRoot, lazy, untrack } from "solid-js";
import type { ActivationSource } from "../keys/registry";
import { copy } from "./copy";
import type { Actor } from "@contracts/Actor";
import type { Kind } from "@contracts/Kind";
import type { Todo } from "@contracts/todo/Todo";
import type { Unsubscribe } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import type { Candidate } from "./queue";
import type { StateAlerts } from "../rail/stateAlerts";
import type { ProjectAlerts } from "../state/projectAlerts";

const TodoHost = lazy(() => import("../todos/TodoDrawer").then(module => ({ default: module.TodoHost })));

const TITLE_CHARS = 60;

const cut = (text: string): string => (text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text);

const todoItem = (id: number) => `todo:${id}`;

const padItem = (name: string) => `pad:${name}`;

/** U410: the Events of one open Project that make a Toast, as Candidates. `select` is how a click reaches the Agent's row, `show` the Project's tab. */
export const watchProject = (connected: ConnectedProject, pushCandidate: (candidate: Candidate) => void, show: () => void, isActive: () => boolean, settleItem: (item: string) => void, alerts?: StateAlerts, suppress: (key: string) => void = () => {}, project: () => ProjectAlerts = () => "all"): Unsubscribe => {
  const { rail, events, app, drawer } = connected;
  const owned = (item: string) => JSON.stringify([connected.project.path, item]);
  const settle = (item: string) => settleItem(owned(item));
  const push = (candidate: Candidate) => pushCandidate({ ...candidate, key: owned(candidate.key), item: owned(candidate.item), project: connected.project.path });
  // The Kind each Agent last had, so a load or a repeat makes no Toast.
  const seen = new Map<string, Kind>(rail.nodes.flatMap((node) => (node.status ? [[node.id, node.status.kind] as const] : [])));

  const stopFiltering = createRoot(dispose => {
    createEffect(() => {
      for (const node of rail.nodes) if (node.alert_level === "quiet") untrack(() => suppress(owned(node.id)));
    });

    return dispose;
  });

  const byAgent = (actor: Actor, item: string, line: string, open: Candidate["open"]): Candidate | null => {
    if (actor.kind !== "agent") return null;

    const node = rail.nodes.find((each) => each.id === actor.id);

    if (node?.alert_level === "quiet") {
      if (item.startsWith("todo:")) connected.held.retain({ agent: actor.id, name: node.name, kind: node.status?.kind ?? "working", line: node.status?.label ?? "", at: Date.now() });

      return null;
    }

    return {
      key: actor.id,
      item,
      kind: node?.status?.kind ?? "working",
      name: rail.nameOf(actor),
      line,
      selected: isActive() && rail.selected() === actor.id,
      // A Todo edit is no `needs-you` or `error`: a Project narrowed below `all` raises no Sound for it.
      silent: project() !== "all",
      open,
    };
  };

  const openAgent = (id: string) => () => {
    if (!rail.nodes.some((node) => node.id === id)) return null;

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

    if (!listed.some((todo) => todo.id === id)) return null;

    show();
    drawer.open(() => <TodoHost id={id} />, source, { kind: "todo", project: connected.project.path });

    return null;
  };

  const stopEvents = events.subscribe((event) => {
    if (event.name === "agent.status") {
      const { id, status } = event.data;
      const before = seen.get(id);

      seen.set(id, status.kind);

      if (before === undefined || before === status.kind) return;

      const node = rail.nodes.find((each) => each.id === id);

      if (node?.alert_level === "quiet") {
        const choice = status.kind === "idle" ? null : appSettings().stateAlerts[status.kind];

        if (choice?.alert || choice?.sound || choice?.badge || status.kind === "needs-you" || status.kind === "error") {
          connected.held.retain({ agent: id, name: node.name, kind: status.kind, line: status.label, at: Date.now() });
        }

        return;
      }

      const selected = isActive() && rail.selected() === id;
      const raised = alerts?.changed({ key: owned(id), id, name: node?.name ?? id, kind: status.kind, selected, level: node?.alert_level ?? "default", project: project() });

      if (status.kind !== "needs-you" && status.kind !== "error") return;

      push({
        key: id,
        item: `agent:${id}`,
        kind: status.kind,
        name: node?.name ?? id,
        // U6249d: an error toast keeps the name and glyph; its cause shows once, on the Agent's own row.
        line: status.kind === "error" ? "" : copy.needsYou,
        selected,
        silent: raised !== undefined && !raised.chime,
        open: openAgent(id),
      });
    } else if (event.name === "extension.problem") {
      // UA11: one Toast per problem, whatever the Switcher shows.
      const item = `extension:${event.data.extension}:${event.data.cause}`;

      push({ key: item, item, kind: "error", name: event.data.extension, line: event.data.cause, selected: false, open: () => null });
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
    }
  });

  return () => { stopEvents(); stopFiltering(); };
};
