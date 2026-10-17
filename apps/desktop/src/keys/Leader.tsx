import { createEffect, For, onCleanup, Show } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "../copy";
import { LEADER, LEADER_ARM } from "./chords";
import { armLeader, endLeader, leaderArmed, modalOpen, registerKeys } from "./registry";

/** U2239, U2240: `⌘K` waits for one key; while it waits a panel lists the keys of `LEADER`. The panel takes no focus and no pointer events. A pointer press, a modal layer opening or leaving the Project ends the wait. */
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

  return (
    <Show when={leaderArmed()}>
      <div class="leader" role="status" aria-label={copy.leaderPanel}>
        <For each={LEADER}>
          {(key) => (
            <p class="leader-line">
              <span class="leader-keys">{key.keys}</span>
              {`  ${key.what}`}
            </p>
          )}
        </For>
      </div>
    </Show>
  );
};
