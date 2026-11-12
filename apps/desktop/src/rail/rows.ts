import { modalOpen } from "../keys/registry";
import { strandedFocus } from "../keys/stranded";

/** The focusable element of a row of the Rail's tree: Ark's item, or the control of a branch. */
export const ROW = '[data-part="item"], [data-part="branch-control"]';

/** A control inside a row owns its keys: the tree walks, selects and types ahead only on a key whose target is a row (U31). */
export const ownKeys = { onKeyDown: (press: KeyboardEvent) => press.stopPropagation() };

/** The id of the row a key press targets; `undefined` when its target is anything but a row, such as a button or the rename field inside one. */
export const focusedRowId = (press: KeyboardEvent): string | undefined =>
  press.target instanceof HTMLElement && press.target.matches(ROW) ? press.target.closest<HTMLElement>("[data-id]")?.dataset.id : undefined;

/** U6829b: a row key acts on the focused row, or on the clicked (selected) row while a click has left focus on the page body. */
export const rowIdAt = (focus: Element | null, selected: string | null | undefined): string | undefined => focus instanceof HTMLElement && focus.matches(ROW) ? focus.closest<HTMLElement>("[data-id]")?.dataset.id
  : focus === document.body && !modalOpen() ? selected ?? undefined : undefined;

export const keyedRowIdAt = (press: KeyboardEvent, selected: string | null | undefined): string | undefined => focusedRowId(press) ?? (strandedRow(press) ? rowIdAt(document.body, selected) : undefined);

/** U6829b: a key press a click left stranded on the page body, once per press. */
export const strandedRow = (press: KeyboardEvent): boolean => strandedFocus(press) && !press.repeat && railClicked();

let lastClickInRail = false;

export const railClicked = (): boolean => lastClickInRail;

export const forgetClick = (): void => { lastClickInRail = false; };

/** Only the surface clicked last owns a body press: a click on a Shelf row or a Project tab releases the Rail's claim. */
export const noteClick = (click: MouseEvent): void => { lastClickInRail = click.target instanceof Element && click.target.closest(ROW) !== null && click.target.closest(".rail-tree") !== null; };

export type RowActions = {
  folder: () => void;
  editor: () => void;
} & (
  | { kind: "workstream"; restart?: { pending: boolean; run: () => void; menu: (click: MouseEvent) => void } }
  | { kind: "group" }
  | { kind: "agent"; restart?: { pending: boolean; run: () => void; menu: (click: MouseEvent) => void }; stop?: () => void; resume?: () => void }
);
