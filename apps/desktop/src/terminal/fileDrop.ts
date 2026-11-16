import { onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { createRestartable } from "../ink/restartable";
import type { ConnectedProject } from "../state/connectedProject";
import type { Screens } from "./screens";

/**
 * U162: the window's native File drop, reported by the App seam, taken by one view of a Terminal: the pane or a Bubble.
 * `body` is the view's rectangle and `terminal` the Terminal it shows. The answer is true while an `over` is inside the rectangle of a Terminal that takes input,
 * so the view shows its ring only while a drop would be taken.
 */
export const createFileDrop = (
  connected: Pick<ConnectedProject, "app" | "daemonExit">,
  screens: () => Pick<Screens, "emulatorFor" | "exited" | "pastePaths">,
  terminal: () => string | null,
  body: () => HTMLElement | undefined,
): Accessor<boolean> => {
  const takes = (): string | null => {
    const id = terminal();

    return id !== null && connected.daemonExit() === null && !screens().exited(id) ? id : null;
  };

  const [over, setOver] = createRestartable(takes, false);

  const inBody = (x: number, y: number): boolean => {
    const view = body();
    const box = view?.getBoundingClientRect();

    if (view === undefined || box === undefined || x < box.left || x >= box.right || y < box.top || y >= box.bottom) return false;

    // An open Drawer or another view sits over this one, so the rectangle alone would take its drops.
    const hit = document.elementFromPoint?.(x, y);

    return hit === undefined || (hit !== null && view.contains(hit));
  };

  onCleanup(connected.app.onFileDrop((drop) => {
    const id = takes();

    if (drop.phase === "leave" || id === null || !inBody(drop.x, drop.y)) {
      setOver(false);

      return;
    }

    setOver(drop.phase === "over");

    if (drop.phase === "drop") {
      screens().emulatorFor(id).focus();
      screens().pastePaths(id, drop.paths);
    }
  }));

  return over;
};
