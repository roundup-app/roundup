import type { ShelfFrame } from "./frame";

/** U370: leader `S` toggles, `esc` from inside; focus goes to the open tab on opening and back to where it was on closing. */
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

  const onEscape = (press: KeyboardEvent) => {
    if (press.defaultPrevented || press.key !== "Escape" || !props.frame.open() || !(press.target instanceof Element)) return;

    const shelf = props.shelf();
    // A naming field can remove itself while handling Escape; its original path
    // still belongs to the Shelf, so that same key must not close the fallback.
    const inside = shelf !== null && press.composedPath().includes(shelf);
    const overlay = props.shelf()?.closest(".window")?.getAttribute("data-shelf-mode") === "overlay";

    if (!inside && (!overlay || !press.target.closest(".centre"))) return;

    if ((inside && press.target.closest("input, textarea, [contenteditable]")) || document.querySelector('.drawer[data-open="true"], [role="dialog"], [role="alertdialog"]')) return;

    press.preventDefault();
    press.stopPropagation();
    toggle();
  };

  document.addEventListener("keydown", onEscape);

  return {
    toggle,
    stop: () => {
      document.removeEventListener("keydown", onEscape);
    },
  };
};
