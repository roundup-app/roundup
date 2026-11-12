import type { registerKeys } from "../keys/registry";

type Deps = {
  panel: () => HTMLElement | undefined;
  recording: () => string | null;
  values: () => readonly string[];
  highlighted: () => string | null;
  highlight: (value: string) => void;
  choose: (value: string | null) => void;
  focusInput: () => void;
};

/** U6829c: the Switcher is modal, so its move and choose keys act when a click has left focus outside the panel; Ark's Combobox hears them only from its field. */
export const strandedSwitcherKeys = (deps: Deps): Parameters<typeof registerKeys>[1] => [{
  chords: ["ArrowUp", "ArrowDown", "Enter"],
  when: event => event.target instanceof Node && !deps.panel()?.contains(event.target) && deps.recording() === null && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey,
  run: event => {
    if (event.key === "Enter") return deps.choose(deps.highlighted());

    const values = deps.values();
    const current = deps.highlighted();
    const at = current === null ? -1 : values.indexOf(current);
    const next = values[Math.min(values.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];

    if (next !== undefined) deps.highlight(next);
    deps.focusInput();
  },
}];
