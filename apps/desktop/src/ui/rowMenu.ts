import { registerKeys } from "../keys/registry";
import { openOnRelease } from "./contextMenu";

/** U7310e: a list's rows each open a native menu: a right-click on the row, or ContextMenu or Shift+F10 with focus in it, below the focused control. Returns the list's `contextmenu` handler. */
export const createRowMenu = (list: () => HTMLElement | undefined, row: string, open: (found: HTMLElement, x: number, y: number) => void) => {
  const rowOf = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(row) : null;

  registerKeys({ kind: "region", element: list }, [{
    chords: ["ContextMenu", "Shift+F10"],
    when: event => rowOf(event.target) !== null,
    run: event => {
      const found = rowOf(event.target);

      if (event.repeat || !found || !(event.target instanceof Element)) return;

      const box = event.target.getBoundingClientRect();
      open(found, box.left, box.bottom);
    },
  }]);

  return (event: MouseEvent) => {
    const found = rowOf(event.target);

    if (found) openOnRelease(event, (x, y) => open(found, x, y));
  };
};
