// fallow-ignore-file duplicate-export -- AGENT and todo are toast-specific fixtures; Pad and Todo tests import their own fixtures directly.
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
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
import { createStateAlerts } from "../rail/stateAlerts";
import type { ProjectAlerts } from "../state/projectAlerts";

export const TOAST_AGENT: Actor = { kind: "agent", id: "a", parent: null };

export const toastTodo = (id: number, creator: Actor, title = "ship it"): Todo => ({ id, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, updated_at: 0, creator, home: null, owner: null, refs: [], priority: null });

export const pad = (name: string, _actor: Actor): Pad => ({ incarnation: `fixture-${name}`, name, text: "", updated_at: 0, revision: 1, home: null });

/** U5151a: the Adapter-mapped cause and next action a failed turn carries. */
export const FAILURE = "Claude's servers failed; send the Agent a message to retry.";

/** The cause a refused `todo.list` carries, which a Toast's open shows as its failure line. */
export const UNREADABLE = "Daemon unavailable";

export const status = (id: string, kind: Kind) =>
  event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(Math.random()).slice(2), status: { kind, label: kind === "error" ? FAILURE : kind, since: NOW, finished: "0" } } });

/** The failure lines on screen. ui-sdk's hidden announcer is an alert too, and no line. */
export const alerts = (options?: { hidden?: boolean }) => screen.queryAllByRole("alert", options).filter((node) => !node.hasAttribute("data-ui-sdk-announcer"));

export const by = (actor: Actor, data: Parameters<typeof event>[0]) => ({ ...event(data), actor });

/** The Toasts on a fake Daemon: `front` is whether roundup is the app in front, `sounds` counts the chimes. */
export const mountToasts = async (tree: RailNode[], options: { unreadable?: true; todos?: Todo[]; pads?: Pad[]; selected?: string | null; reducedMotion?: boolean; front?: boolean; project?: ProjectAlerts } = {}) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree;
  app.handlers["todo.list"] = () => options.todos ?? [];
  app.handlers["pad.list"] = () => options.pads ?? [];
  Object.assign(app.handlers, todoHandlers({ todos: options.todos ?? [] }, () => {}));

  if (options.unreadable) app.handlers["todo.list"] = () => { throw new Error(UNREADABLE); };

  app.handlers["pad.read"] = ({ name }) => (options.pads ?? []).find((each) => each.name === name)!;

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => options.reducedMotion ?? false, () => NOW);
  const [front, setFront] = createSignal(options.front ?? true);
  /** Whether roundup is in front changes at once, as it does when the user switches windows. */
  const moveFront = (value: boolean) => { setFront(value); flush(); };

  const sounds: number[] = [];
  const shown: string[] = [];
  const alertFailures: (string | null)[] = [];
  let queue!: ReturnType<typeof createToastQueue>;

  if (options.selected !== undefined) {
    connected.rail.select(options.selected);
    flush();
  }

  const view = render(() => {
    queue = createToastQueue(front, () => sounds.push(Date.now()));
    watchProject(connected, queue.push, () => shown.push("/p"), () => true, queue.settle, createStateAlerts(alert => app.stateAlert(alert), front, message => alertFailures.push(message)), queue.suppress, () => options.project ?? "all");

    return (
      <ConnectedProjectContext value={connected}>
        <Toasts queue={queue} />
        <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
      </ConnectedProjectContext>
    );
  });

  const toasts = () => [...view.container.querySelectorAll<HTMLElement>(".app-toast-action")];

  return { alertFailures, app, connected, view, queue, sounds, shown, toasts, setFront: moveFront, leaveWindow: () => moveFront(false), comeBack: () => { moveFront(true); fireEvent(window, new Event("focus")); } };
};

