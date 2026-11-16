import { createEffect, createSignal } from "solid-js";
import type { ConnectedProject } from "../state/connectedProject";
import { ROW } from "./rows";

export const createRailDrag = (rail: ConnectedProject["rail"], container: () => HTMLElement | undefined, openRow: (id: string) => void) => {
  /** One indent step (--rail-step) in pixels: how far sideways the pointer goes to change the drop's depth. */
  const [railStep, setRailStep] = createSignal(1);

  let pointerAt: { x: number; y: number } | null = null;

  /** Whether the release fell outside the Rail, kept from `pointerup` until the next press or key: the move runs after the drop's glide, when the pointer may be elsewhere. */
  let released: boolean | null = null;

  const outside = (point: { x: number; y: number }) => {
    const box = container()?.getBoundingClientRect();

    return box !== undefined && (point.x < box.left || point.x >= box.right || point.y < box.top || point.y >= box.bottom);
  };

  const pointerOutside = () => released ?? (pointerAt !== null && outside(pointerAt));

  createEffect(container, tree => {
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
      released = null;
      pointerAt = { x: event.clientX, y: event.clientY };
    };

    const release = (event: PointerEvent) => { released = outside({ x: event.clientX, y: event.clientY }); };

    const clear = () => { released = null; };

    const follow = (event: PointerEvent) => { pointerAt = { x: event.clientX, y: event.clientY }; };

    // U31: Enter on a row selects it.
    const enter = (key: KeyboardEvent) => {
      if (key.key !== "Enter" || key.metaKey || key.ctrlKey || key.altKey || key.shiftKey || !(key.target instanceof HTMLElement) || !key.target.matches(ROW)) return;

      const id = key.target.closest<HTMLElement>("[data-id]")?.dataset.id;

      if (id === undefined || !rail.nodes.some(node => node.id === id)) return;
      key.stopPropagation();
      key.preventDefault();
      openRow(id);
    };

    window.addEventListener("pointerdown", press, { capture: true });
    window.addEventListener("pointermove", follow, { capture: true });
    window.addEventListener("pointerup", release, { capture: true });
    window.addEventListener("keydown", clear, { capture: true });
    // listener-owner: this effect's cleanup removes it with the window listeners when the tree element changes.
    tree.addEventListener("keydown", enter, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", press, { capture: true });
      window.removeEventListener("pointermove", follow, { capture: true });
      window.removeEventListener("pointerup", release, { capture: true });
      window.removeEventListener("keydown", clear, { capture: true });
      tree.removeEventListener("keydown", enter, { capture: true });
    };
  });

  return { railStep, pointerOutside };
};
