import type { ActivationSource } from "../keys/registry";
import { copy } from "../copy";
import type { Actor } from "@contracts/Actor";
import type { Kind } from "@contracts/Kind";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import type { Unsubscribe } from "../app/seam";
import { usePadList } from "../rail/pads/padList";
import type { ConnectedProject } from "../state/connectedProject";
import { useTodoList } from "../todos/todoList";
import { TodoDrawer } from "../todos/TodoDrawer";
import { PadDrawer } from "../pads/PadDrawer";
import type { Candidate } from "./queue";

const TITLE_CHARS = 60;

const cut = (text: string): string => (text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text);

const GONE = copy.thatIsGone;

/** U410: the Events of one open Project that make a Toast, as Candidates. `select` is how a click reaches the Agent's row, `show` the Project's tab. */
export const watchProject = (connected: ConnectedProject, push: (candidate: Candidate) => void, show: () => void, isActive: () => boolean): Unsubscribe => {
  const { rail, events, app, drawer } = connected;
  // The Kind each Agent last had, so a load or a repeat makes no Toast.
  const seen = new Map<string, Kind>(rail.nodes.flatMap((node) => (node.status ? [[node.id, node.status.kind] as const] : [])));

  const byAgent = (actor: Actor, line: string, open: Candidate["open"]): Candidate | null => {
    if (actor.kind !== "agent") return null;

    const node = rail.nodes.find((each) => each.id === actor.id);

    return {
      key: actor.id,
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
    drawer.open(() => <TodoHost id={id} />, source);

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
    drawer.open(() => <PadHost name={name} />, source);

    return null;
  };

  return events.subscribe((event) => {
    if (event.name === "agent.status") {
      const { id, status } = event.data;
      const before = seen.get(id);

      seen.set(id, status.kind);

      if (before === status.kind || (status.kind !== "needs-you" && status.kind !== "error")) return;

      const node = rail.nodes.find((each) => each.id === id);

      push({
        key: id,
        kind: status.kind,
        name: node?.name ?? id,
        line: status.kind === "error" ? copy.failedStatus : copy.needsYou,
        selected: isActive() && rail.selected() === id,
        open: openAgent(id),
      });
    } else if (event.name === "todo.updated" && event.data.creator.kind === "user") {
      const candidate = byAgent(event.actor, copy.changedTodo(cut(event.data.title)), openTodo(event.data.id));

      if (candidate) push(candidate);
    } else if (event.name === "pad.changed" && event.actor.kind === "agent") {
      const name = event.data.name;
      const actor = event.actor;

      void app.rpc("pad.list", null).then(
        (pads) => {
          if (!pads.some((pad) => pad.name === name && pad.owner.kind === "user")) return;

          const candidate = byAgent(actor, copy.changedPad(cut(name)), openPad(name));

          if (candidate) push(candidate);
        },
        () => undefined,
      );
    }
  });
};

/** The Todo's Drawer, with the shared list the Shelf reads (U15); it lives while the Drawer does. */
const TodoHost = (props: { id: number }) => <TodoDrawer id={props.id} todos={useTodoList()} />;

/** The Pad's Drawer, as the Shelf's row opens it. */
const PadHost = (props: { name: string }) => {
  const list = usePadList();

  return <PadDrawer name={props.name} pads={list.pads} onLateFailure={() => {}} />;
};
