import { focusCentre, inCentre, isTextEntry, layerOpen } from "./focus";

/** U7158: a press that types a character: a character or a dead key, with no ⌘, Ctrl or Option and no composition under way.
 * Space types only with nothing focused; on a control it presses. */
const types = (event: KeyboardEvent): boolean => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;

  if (event.key === " ") return document.activeElement === document.body;

  return event.key === "Dead" || [...event.key].length === 1;
};

/** Rows a letter must never find (U7158): the library behind the Rail has no switch to turn its type-to-find off. */
const LISTS = "[role=tree], [role=treegrid], [role=listbox], [role=grid]";

/** U7158: a typed character pressed on something that takes no text goes to the centre Terminal.
 * Focus moves during `keydown`, so the browser delivers the key itself and IME and dead keys arrive whole; the key is never re-sent.
 * No later listener sees the press: a tree row's own handler would cancel it before the browser delivers it.
 * An Agent that waits for the user gets the focus and not the key. A modal layer keeps every key for itself. */
export const strayKey = (event: KeyboardEvent, modal: boolean): void => {
  if (modal || !types(event) || !(event.target instanceof Element) || isTextEntry(event.target) || inCentre(event.target) || layerOpen()) return;

  const to = focusCentre();

  if (!to) {
    if (event.target.closest(LISTS)) event.stopImmediatePropagation();

    return;
  }

  event.stopImmediatePropagation();

  if (to.waiting) event.preventDefault();
};
