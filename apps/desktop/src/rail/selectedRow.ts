/** The Rail's selected row: a Workstream or Agent row, while one is selected. */
export const selectedRailRow = (): HTMLElement | null => document.querySelector<HTMLElement>('.rail [data-selected="true"].rail-row');
