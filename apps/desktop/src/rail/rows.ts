/** The focusable element of a row of the Rail's tree: Ark's item, or the control of a branch. */
export const ROW = '[data-part="item"], [data-part="branch-control"]';

/** A control inside a row owns its keys: the tree walks, selects and types ahead only on a key whose target is a row (U31). */
export const ownKeys = { onKeyDown: (press: KeyboardEvent) => press.stopPropagation() };

/** The id of the row a key press targets; `undefined` when its target is anything but a row, such as a button or the rename field inside one. */
export const focusedRowId = (press: KeyboardEvent): string | undefined =>
  press.target instanceof HTMLElement && press.target.matches(ROW) ? press.target.closest<HTMLElement>("[data-id]")?.dataset.id : undefined;
