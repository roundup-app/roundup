import { createSignal } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import type { registerKeys } from "../keys/registry";
import { strandedFocus } from "../keys/stranded";

/** U6829c: a Project tab click can leave focus on the page body; while it is the last click, the arrows then move from the open tab to its neighbour, as Ark's tablist does from a focused tab. */
export const strandedTabKeys = (deps: { paths: () => readonly string[]; active: () => string | null | undefined; focusTab: (path: string) => void }): Parameters<typeof registerKeys>[1] => {
  const [clicked, setClicked] = createSignal(false);

  makeEventListener(document, "click", click => setClicked(click.target instanceof Element && click.target.closest(".strip [role=tab]") !== null), true);

  const neighbour = (press: KeyboardEvent): string | undefined => {
    const current = deps.active();
    const at = current ? deps.paths().indexOf(current) : -1;

    return at < 0 ? undefined : deps.paths()[at + (press.key === "ArrowRight" ? 1 : -1)];
  };

  return [{
    chords: ["ArrowLeft", "ArrowRight"],
    when: press => !press.repeat && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey && strandedFocus(press) && clicked() && neighbour(press) !== undefined,
    run: press => {
      const target = neighbour(press);

      if (target !== undefined) deps.focusTab(target);
    },
  }];
};
