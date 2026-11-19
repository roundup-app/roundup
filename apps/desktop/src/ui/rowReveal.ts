import { createSignal } from "solid-js";

/** U7488b: the one reveal state of a row's action icons. `data-reveal="shown"` holds while the pointer is on the row, keyboard focus is within it, or it is selected; the shared rule in `rowButton.styles.css` reads it for Rail, Shelf, Todo and Pad rows. */
export const createRowReveal = (selected: () => boolean) => {
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);

  return {
    get "data-reveal"() { return hovered() || focused() || selected() ? "shown" as const : undefined; },
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocusIn: () => setFocused(true),
    onFocusOut: (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(false);
    },
  };
};
