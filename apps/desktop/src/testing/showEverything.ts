import type { RailNode } from "@contracts/agent/RailNode";
import type { ConnectedProject } from "../state/connectedProject";
import { useShelfScope } from "../todos/shelfScope";
import { SCOPE_ROW, workstream } from "./nodes";

/** U347: a Rail that also holds the row `showEverything` selects. */
export const withScopeRow = (nodes: readonly RailNode[]): RailNode[] => [...nodes, workstream(SCOPE_ROW, { name: "scope", order: 999 })];

/** U347 narrows the Shelf with no row selected; a suite about something else selects `SCOPE_ROW` and chooses `all` to read the whole Project, as U15 and U58 did. */
export const showEverything = async (connected: ConnectedProject): Promise<void> => {
  await connected.rail.settled();
  connected.rail.select(SCOPE_ROW);
  useShelfScope(connected).setShowAll(true);
};

/** The same for a rendered `App`: select the Workstream named `name` (`tree-40` has `backend`) and choose `all` in the Shelf header. */
export const showEverythingInApp = async (name = /backend/): Promise<void> => {
  const { fireEvent, screen } = await import("@solidjs/testing-library");
  const { showShelfTab } = await import("./shelfTabs");
  const item = await screen.findByRole("treeitem", { name });

  fireEvent.click(item.querySelector<HTMLElement>('[data-part="branch-control"]') ?? item);
  showShelfTab("Todos");
  const scope = await screen.findByRole("button", { name: /Show (all Workstreams|only this Workstream)/ });

  if (scope.getAttribute("aria-pressed") === "false") fireEvent.click(scope);
};
