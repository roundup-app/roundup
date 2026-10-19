import { fireEvent, screen, within } from "@solidjs/testing-library";

/** U373: open or select the named list without closing an already open tab. */
export const showShelfTab = (name: "Todos" | "Pads"): void => {
  const tab = within(screen.getByRole("tablist", { name: "Work items" })).getByRole("tab", { name: new RegExp(`^${name}`) });

  if (tab.getAttribute("aria-expanded") !== "true") fireEvent.click(tab);

  const unassigned = document.querySelector<HTMLElement>('.shelf-panel:not([hidden]) [data-shelf-group="unassigned"] [data-part="branch-control"]');

  if (unassigned?.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(unassigned);
};
