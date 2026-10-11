import type { ShelfFrame } from "./frame";

/** U370: `⌘\` by key position, so Caps Lock and the layout do not matter; `esc` from inside; focus goes to the open tab on opening and back to where it was on closing. */
export const shelfKeys = (props: { frame: ShelfFrame; shelf: () => HTMLElement | null }) => {
  let returnTo: HTMLElement | null = null;

  const toggle = () => {
    const opening = !props.frame.open();
    const held = document.activeElement;

    if (opening) {
      returnTo = held instanceof HTMLElement && held !== document.body ? held : null;
    } else if (held instanceof HTMLElement && props.shelf()?.contains(held)) {
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
      else held.blur();

      returnTo = null;
    }

    props.frame.toggle();

    if (opening) queueMicrotask(() => props.shelf()?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }));
  };

  const onChord = (press: KeyboardEvent) => {
    if (press.code !== "Backslash" || !press.metaKey || press.ctrlKey || press.altKey || press.shiftKey) return;

    press.preventDefault();
    press.stopPropagation();

    if (!press.repeat) toggle();
  };

  const onEscape = (press: KeyboardEvent) => {
    if (press.key !== "Escape" || !props.frame.open() || !(press.target instanceof Element) || !props.shelf()?.contains(press.target)) return;

    if (press.target.closest("input, textarea, [contenteditable]") || document.querySelector('.drawer[data-open="true"], [role="dialog"]')) return;

    toggle();
  };

  // Document capture, after Help's window capture: while Help is open the chord does nothing.
  document.addEventListener("keydown", onChord, true);
  document.addEventListener("keydown", onEscape);

  return {
    toggle,
    stop: () => {
      document.removeEventListener("keydown", onChord, true);
      document.removeEventListener("keydown", onEscape);
    },
  };
};
