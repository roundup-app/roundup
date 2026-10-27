import { createEffect, onCleanup } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { LEADER_ARM } from "./chords";
import { armLeader, endLeader, leaderArmed, modalOpen, registerKeys } from "./registry";

/** U2239, U2240: `⌘K` waits for one key; while it waits HintLine lists the available keys without taking focus or pointer events. A pointer press, a modal layer opening or leaving the Project ends the wait. */
export const Leader = () => {
  const { daemonExit } = useConnectedProject();

  registerKeys({ kind: "app" }, [{
    chords: LEADER_ARM,
    when: () => daemonExit() === null && document.querySelector(".spawn-prompt-field") === null,
    run: (press) => { if (!press.repeat) armLeader(press); },
  }]);

  createEffect(() => { if (leaderArmed() && modalOpen()) endLeader(); });

  window.addEventListener("pointerdown", endLeader, true);
  onCleanup(() => {
    window.removeEventListener("pointerdown", endLeader, true);
    endLeader();
  });

  return null;
};
