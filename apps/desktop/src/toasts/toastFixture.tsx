// fallow-ignore-file duplicate-export -- AGENT and todo are toast-specific fixtures; Pad and Todo tests import their own fixtures directly.
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { Kind } from "@contracts/Kind";
import type { Pad } from "@contracts/pad/Pad";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../drawer/DrawerHost";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { todoHandlers } from "../testing/stores";
import { createFakeApp } from "../testing/fakeApp";
import { event, NOW } from "../testing/nodes";
import { createToastQueue } from "./queue";
import { Toasts } from "./Toasts";
import { watchProject } from "./watch";

export const TOAST_AGENT: Actor = { kind: "agent", id: "a", parent: null };

export const toastTodo = (id: number, creator: Actor, title = "ship it"): Todo => ({ id, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, updated_at: 0, creator, home: null, owner: null, refs: [] });

export const pad = (name: string, _actor: Actor): Pad => ({ incarnation: `fixture-${name}`, name, text: "", updated_at: 0, revision: 1, home: null });

export const status = (id: string, kind: Kind) =>
  event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(Math.random()).slice(2), status: { kind, label: kind, since: NOW, finished: "0" } } });

export const by = (actor: Actor, data: Parameters<typeof event>[0]) => ({ ...event(data), actor });

/** The Toasts on a fake Daemon: `front` is whether roundup is the app in front, `sounds` counts the chimes. */
export const mountToasts = async (tree: RailNode[], options: { todos?: Todo[]; pads?: Pad[]; selected?: string | null; reducedMotion?: boolean; front?: boolean } = {}) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree;
  app.handlers["todo.list"] = () => options.todos ?? [];
  app.handlers["pad.list"] = () => options.pads ?? [];
  Object.assign(app.handlers, todoHandlers({ todos: options.todos ?? [] }, () => {}));
  app.handlers["pad.read"] = ({ name }) => (options.pads ?? []).find((each) => each.name === name)!;

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => options.reducedMotion ?? false, () => NOW);
  const [front, setFront] = createSignal(options.front ?? true);
  const sounds: number[] = [];
  const shown: string[] = [];
  let queue!: ReturnType<typeof createToastQueue>;

  if (options.selected !== undefined) connected.rail.select(options.selected);

  const view = render(() => {
    queue = createToastQueue(front, () => sounds.push(Date.now()));
    watchProject(connected, queue.push, () => shown.push("/p"), () => true, queue.settle);

    return (
      <ConnectedProjectContext.Provider value={connected}>
        <Toasts queue={queue} />
        <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
      </ConnectedProjectContext.Provider>
    );
  });

  const toasts = () => [...view.container.querySelectorAll<HTMLElement>(".app-toast-action")];

  return { app, connected, view, queue, sounds, shown, toasts, setFront, leaveWindow: () => { setFront(false); }, comeBack: () => { setFront(true); fireEvent(window, new Event("focus")); } };
};

