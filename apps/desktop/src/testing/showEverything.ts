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
export const showEverythingInApp = async (_name = /backend/): Promise<void> => {
  const { fireEvent, screen } = await import("@solidjs/testing-library");
  const { showShelfTab } = await import("./shelfTabs");
  await screen.findByRole("tree", { name: "Rail" });
  fireEvent.click(document.querySelector('[data-todo-root]')!);
  showShelfTab("Todos");

  for (const control of document.querySelectorAll<HTMLElement>('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')) fireEvent.click(control);
};
