import { createSignal, type Accessor } from "solid-js";

/** U387: a row, a todo row and a Project tab decide "near" from this one predicate: pointer over, focus inside, selected. */
const nearOf = (pointer: boolean, focus: boolean, selected = false): boolean => pointer || focus || selected;

/** The pointer signal of one element and its `:focus-within`, with the handlers that drive them. */
export const createNear = (selected: Accessor<boolean> = () => false) => {
  const [pointer, setPointer] = createSignal(false);
  const [focus, setFocus] = createSignal(false);
  const read = (element: Element) => setFocus(element.matches(":focus-within"));

  return {
    near: () => nearOf(pointer(), focus(), selected()),
    onPointerEnter: () => setPointer(true),
    onPointerLeave: () => setPointer(false),
    onFocusIn: (focus: FocusEvent & { currentTarget: Element }) => read(focus.currentTarget),
    onFocusOut: (blur: FocusEvent & { currentTarget: Element }) => {
      const element = blur.currentTarget;

      queueMicrotask(() => read(element));
    },
  };
};
