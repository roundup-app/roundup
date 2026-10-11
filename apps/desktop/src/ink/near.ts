import { createSignal } from "solid-js";

/** U387: a row, a todo row and a Project tab are "near" on one predicate: pointer over, focus inside, or selected. */
export const createNear = (selected: () => boolean = () => false) => {
  const [pointer, setPointer] = createSignal(false);
  const [focus, setFocus] = createSignal(false);

  return {
    near: () => pointer() || focus() || selected(),
    handlers: {
      onMouseEnter: () => setPointer(true),
      onMouseLeave: () => setPointer(false),
      onFocusIn: () => setFocus(true),
      onFocusOut: (event: FocusEvent & { currentTarget: HTMLElement }) => {
        const next = event.relatedTarget;

        if (!(next instanceof Node && event.currentTarget.contains(next))) setFocus(false);
      },
    },
  };
};
