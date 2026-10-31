import { createEffect, createSignal, onCleanup } from "solid-js";
import { captureFocus } from "../keys/focus";
import type { ConnectedProject } from "../state/connectedProject";
import { ROW } from "./rows";

export const createRailDrag = (rail: ConnectedProject["rail"], container: () => HTMLElement | undefined, openRow: (id: string) => void, focusRow: (id: string) => void) => {
  /** One indent step (--rail-step) in pixels: how far sideways the pointer goes to change the drop's depth. */
  const [railStep, setRailStep] = createSignal(1);

  /** Whether the press that began the drag was a pointer's: a keyboard lift has no pointer to leave the Rail. */
  let pointerPressed = false;
  let pointerAt: { x: number; y: number } | null = null;
  /** The row a keyboard lift began on: the library returns focus only to a handle, and the whole row is the Rail's. */
  let liftedRow: string | null = null;

  const pointerOutside = () => {
    const box = container()?.getBoundingClientRect();

    return pointerPressed && pointerAt !== null && box !== undefined &&
      (pointerAt.x < box.left || pointerAt.x >= box.right || pointerAt.y < box.top || pointerAt.y >= box.bottom);
  };

  createEffect(() => {
    const tree = container();

    if (!tree) return;

    if (tree) {
      // --rail-step is a calc(), so a probe resolves it to pixels once.
      const probe = tree.appendChild(document.createElement("span"));
      probe.style.display = "inline-block";
      probe.style.width = "var(--rail-step)";
      const width = probe.getBoundingClientRect().width;
      probe.remove();

      if (width > 0) setRailStep(width);
    }

    const press = (event: PointerEvent) => {
      pointerPressed = true;
      pointerAt = { x: event.clientX, y: event.clientY };
    };

    const follow = (event: PointerEvent) => { pointerAt = { x: event.clientX, y: event.clientY }; };

    const lift = (key: KeyboardEvent) => {
      pointerPressed = false;

      if (key.code === "Space" && key.target instanceof HTMLElement && key.target.matches(ROW)) liftedRow = key.target.closest<HTMLElement>("[data-id]")?.dataset.id ?? null;

      // U31: Enter on a row selects it. The library would lift on Enter too, so Enter stops here and selects, and only Space lifts.
      if (key.key !== "Enter" || key.metaKey || key.ctrlKey || key.altKey || key.shiftKey || !(key.target instanceof HTMLElement) || !key.target.matches(ROW)) return;

      const id = key.target.closest<HTMLElement>("[data-id]")?.dataset.id;

      if (id === undefined || !rail.nodes.some(node => node.id === id)) return;
      key.stopPropagation();
      key.preventDefault();
      openRow(id);
    };

    window.addEventListener("pointerdown", press, { capture: true });
    window.addEventListener("pointermove", follow, { capture: true });
    tree.addEventListener("keydown", lift, { capture: true });
    onCleanup(() => {
      window.removeEventListener("pointerdown", press, { capture: true });
      window.removeEventListener("pointermove", follow, { capture: true });
      tree.removeEventListener("keydown", lift, { capture: true });
    });
  });

  const placeDrop = (next: { depth: number } | null) => {
    if (next !== null) return;
    const back = liftedRow;

    liftedRow = null;

    if (back !== null) {
      const focus = captureFocus();
      requestAnimationFrame(() => focus(() => focusRow(back)));
    }
  };

  return { railStep, pointerOutside, placeDrop };
};
