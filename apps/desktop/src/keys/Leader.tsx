import { KeyHint } from "./KeyHint";
import { createEffect, For, onCleanup, Show } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "../copy";
import { LEADER, LEADER_ARM } from "./chords";
import { armLeader, captureActions, endLeader, leaderArmed, modalOpen, registerKeys } from "./registry";

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

  // U2240: the panel is one line in the header band over the centre pane, so it covers no Terminal, Rail row or Shelf; measured when it appears.
  const place = (panel: HTMLElement) => {
    const centre = document.querySelector(".centre")?.getBoundingClientRect();

    if (!centre) return;

    panel.style.setProperty("--leader-left", `${centre.left}px`);
    panel.style.setProperty("--leader-width", `${centre.width}px`);
  };

  const offered = () => {
    const actions = captureActions(document.activeElement);

    return LEADER.filter(key => {
      const action = actions.find(row => row.value === `action:leader:${key.keys}`);

      return action?.available() ?? true;
    });
  };

  return (
    <Show when={leaderArmed()}>
      <aside class="leader" role="status" aria-label={copy.leaderPanel} ref={place}>
        <For each={offered()}>
          {(key) => (
            <KeyHint class="leader-line" keys={key.keys}>{key.short}</KeyHint>
          )}
        </For>
      </aside>
    </Show>
  );
};
