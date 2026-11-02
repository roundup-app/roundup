import type { RailNode } from "@contracts/agent/RailNode";
import type { ConnectedProject } from "../state/connectedProject";
import { SCOPE_ROW, workstream } from "./nodes";

/** A spare Workstream lets selection-lifetime tests leave Overview. */
export const withScopeRow = (nodes: readonly RailNode[]): RailNode[] => [...nodes, workstream(SCOPE_ROW, { name: "scope", order: 999 })];

/** U2744a: select Overview to read the entire Project. */
export const showEverything = async (connected: ConnectedProject): Promise<void> => {
  await connected.rail.settled();
  connected.rail.select(null);
};

/** Select Overview and open Unassigned in a rendered App. */
export const showEverythingInApp = async (_name = /backend/, tab: "Todos" | "Pads" = "Todos"): Promise<void> => {
  const { fireEvent, screen, waitFor } = await import("@solidjs/testing-library");
  const { showShelfTab } = await import("./shelfTabs");
  const { openProjectPage, projectMenu } = await import("./menuProbe");

  if (!screen.queryByLabelText("Rail", { selector: '[role="tree"]' })) openProjectPage("view:workstreams", projectMenu.path);
  await screen.findByLabelText("Rail", { selector: '[role="tree"]' });
  fireEvent.click(document.querySelector('[data-todo-root]')!);

  showShelfTab(tab);

  const panel = await waitFor(() => {
    const panel = document.querySelector(`.shelf .${tab.toLowerCase()}-tab`);

    if (!panel?.querySelector("[data-shelf-group], .shelf-done-line, .empty-state")) throw new Error("Shelf list has not loaded");

    return panel;
  });

  for (const control of panel.querySelectorAll<HTMLElement>('[data-shelf-group] [data-part="branch-control"]')) {
    if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") !== "false") continue;
    fireEvent.click(control);
    await waitFor(() => {
      if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") !== "true") throw new Error("Shelf owner has not opened");
    });
  }
};
