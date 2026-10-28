import { registerKeys } from "./registry";
import { RAIL_KEYS } from "./chords";
import { placeOf } from "./places";
import { ROW } from "../rail/rows";

const rowOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof HTMLElement && target.matches(ROW) ? target : null;

/** `F2`, the Rail key U31 leaves to U41 (GLOSSARY.md, Rail); the tree's own `←`, `→` come from Ark (U520). No UI of its own. */
export const Keys = () => {
  const onRename = (row: HTMLElement): void => {
    row.querySelector(".name")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  };

  registerKeys({ kind: "region", element: () => document.querySelector<HTMLElement>('[role="tree"]') ?? undefined }, [
    { chords: RAIL_KEYS,
      when: (press) => {
        const row = rowOf(press.target);

        return placeOf(press.target instanceof Element ? press.target : null) === "rail" && row !== null && !row.classList.contains("sortable-source") && press.key === "F2";
      },
      run: (press) => {
        const row = rowOf(press.target);

        if (!row) return;

        onRename(row);
      },
    },
  ]);

  return null;
};
