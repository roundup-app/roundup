/** U421: the right-button Pull as one tagged union. Kinds exclude each other; `step` is the only transition. */

export type Point = { x: number; y: number };

/** No Pull runs. The flags act after `up`: the release and the `contextmenu` of a Pull that just ended are swallowed once. */
export type Idle = { kind: "idle"; swallowMenu: boolean; swallowUp: boolean };

/** The right button is down and has not yet moved `PULL_DISTANCE`. */
export type Pressed = { kind: "pressed"; press: Point; pointer: Point; selection: string | null; target: EventTarget | null; pointerId: number | undefined };

/** A Pull runs. `pointer`, `id`, `frame` and `openedId` are mutable fields: a move writes `pointer` and allocates no union. */
export type Pulling = Omit<Pressed, "kind"> & { kind: "pulling"; id: string | null; frame: number | null; openedId: string | null };

export type Pull = Idle | Pressed | Pulling;

export type PullEvent =
  | { type: "clear" }
  | { type: "press"; press: Point; selection: string | null; target: EventTarget | null; pointerId: number | undefined }
  | { type: "start" }
  | { type: "release" }
  | { type: "cancel" }
  | { type: "menu" }
  | { type: "mouseup" };

export const idle = (swallowMenu = false, swallowUp = false): Idle => ({ kind: "idle", swallowMenu, swallowUp });

/** A Pull ending, by release or cancel, leaves its menu and release to be swallowed once. */
const ended = (pull: Pull): Idle => (pull.kind === "pulling" ? idle(true, true) : idle());

export const step = (pull: Pull, event: PullEvent): Pull => {
  switch (event.type) {
    case "clear":
      return idle();
    case "press":
      return { kind: "pressed", press: event.press, pointer: event.press, selection: event.selection, target: event.target, pointerId: event.pointerId };
    case "start":
      return pull.kind === "pressed" ? { ...pull, kind: "pulling", id: null, frame: null, openedId: null } : pull;
    case "release":
    case "cancel":
      return pull.kind === "idle" ? pull : ended(pull);
    case "menu":
      return pull.kind === "idle" && pull.swallowMenu ? { ...pull, swallowMenu: false } : pull;
    case "mouseup":
      return pull.kind === "idle" && pull.swallowUp ? { ...pull, swallowUp: false } : pull;
  }
};
