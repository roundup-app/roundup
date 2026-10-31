import { createEffect, onCleanup } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { CHORDS } from "./chords";
import { armLeader, endLeader, leaderArmed, modalOpen, registerKeys } from "./registry";

/** U2239, U2240: `⌘K` waits for one key; while it waits HintLine lists the available keys without taking focus or pointer events. A pointer press, a modal layer opening or leaving the Project ends the wait. */
export const Leader = () => {
  const { daemonExit } = useConnectedProject();

  registerKeys({ kind: "app" }, [{
    action: CHORDS.find(row => row.keys === "⌘K")!,
    searchable: false,
    capture: () => ({ available: () => daemonExit() === null && document.querySelector(".spawn-prompt-field") === null, invoke: () => armLeader() }),
  }]);

  createEffect(() => { if (leaderArmed() && modalOpen()) endLeader(); });

  const pointer = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest(".hint-line.leader button[data-hint]:not(:disabled)")) return;
    endLeader();
  };

  window.addEventListener("pointerdown", pointer, true);
  onCleanup(() => {
    window.removeEventListener("pointerdown", pointer, true);
    endLeader();
  });

  return null;
};
