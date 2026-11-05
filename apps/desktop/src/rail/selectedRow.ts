/** The Rail's selected row: a Workstream or Agent row, or the Overview button while none is selected. */
export const selectedRailRow = (): HTMLElement | null => document.querySelector<HTMLElement>('.rail-row[data-selected="true"], .todo-project-root[aria-pressed="true"]');
