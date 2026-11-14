import type { RailNode } from "@contracts/agent/RailNode";
import type { MenuEntry } from "../../ui/contextMenu";

/** A row-menu item as data: it shows when `when` holds; `entries` is built only then. */
type Item = { when: boolean; entries: () => MenuEntry[] };

export const item = (when: boolean, entries: () => MenuEntry[]): Item => ({ when, entries });

/** U2694b: the items that show, in the order given. */
export const shown = (items: readonly Item[]): MenuEntry[] => items.filter(each => each.when).flatMap(each => each.entries());

export type Table = "group" | "queued" | "workstream" | "agent";

/** Which of the row menu's tables a row takes: a Group, a queued Workstream, a Workstream with no Agent at it, or an Agent. */
export const tableOf = (node: RailNode, queued: boolean): Table => {
  if (node.kind === "group") return "group";

  if (queued) return "queued";

  return node.kind === "workstream" && node.attempt === null ? "workstream" : "agent";
};

/** U68, A5213: which of an Agent's own items show, from what its Terminal and its saved conversation allow. */
export const agentOffers = (node: RailNode, running: boolean, resumable: boolean, mode: boolean) => ({
  restart: node.yolo && !mode && running,
  yolo: !node.yolo && (running || node.can_resume),
  stop: running,
  resume: resumable,
});

/** The Queue's move items: up unless first, down unless last. */
export const queueMoves = (place: number, of: number) => ({ up: place > 1, down: place < of });
