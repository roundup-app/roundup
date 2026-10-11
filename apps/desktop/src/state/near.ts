import { createSignal, type Accessor } from "solid-js";

/** U387: a row, a todo row and a Project tab decide "near" from this one predicate: pointer over, focus inside, selected. */
const nearOf = (pointer: boolean, focus: boolean, selected = false): boolean => pointer || focus || selected;

/** The pointer and focus signals of one element, with the handlers that drive them. */
export const createNear = (selected: Accessor<boolean> = () => false) => {
  const [pointer, setPointer] = createSignal(false);
  const [focus, setFocus] = createSignal(false);

  return {
    pointer,
    focus,
    near: () => nearOf(pointer(), focus(), selected()),
    onPointerEnter: () => setPointer(true),
    onPointerLeave: () => setPointer(false),
    onFocusIn: () => setFocus(true),
    onFocusOut: (blur: FocusEvent & { currentTarget: Element }) => {
      if (!(blur.relatedTarget instanceof Node && blur.currentTarget.contains(blur.relatedTarget))) setFocus(false);
    },
  };
};
