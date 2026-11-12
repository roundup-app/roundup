import type { registerKeys } from "../keys/registry";
import { strandedFocus } from "../keys/stranded";

/** U6829c: a click can leave focus on the page body; the arrows then move from the open tab to its neighbour, as Ark's tablist does from a focused tab. */
export const strandedTabKeys = (paths: () => readonly string[], props: { active: string | null | undefined }, focusTab: (path: string) => void): Parameters<typeof registerKeys>[1] => {
  const neighbour = (press: KeyboardEvent): string | undefined => {
    const current = props.active;
    const at = current ? paths().indexOf(current) : -1;

    return at < 0 ? undefined : paths()[at + (press.key === "ArrowRight" ? 1 : -1)];
  };

  return [{
    chords: ["ArrowLeft", "ArrowRight"],
    when: press => !press.repeat && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey && strandedFocus(press) && neighbour(press) !== undefined,
    run: press => {
      const target = neighbour(press);

      if (target !== undefined) focusTab(target);
    },
  }];
};
