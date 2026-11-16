import { focusTarget } from "../keys/focus";

/** The Rail's selected row: a Workstream or Agent row, while one is selected. */
export const selectedRailRow = (): HTMLElement | null => focusTarget("rail.selected") ?? null;
