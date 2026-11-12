import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { byUrgency } from "../ink/glyph";
import { attentionCounts } from "./attention";
import { agentKindsBelow } from "./layout";
import { descendantsOf, isWorkstream, type RailSource } from "../state/railTopology";

/** U5940a, DCL2: whether the owner dismissed the node's current failure. */
type Dismissed = (node: RailNode) => boolean;

/** DCL2: the Kind a Workstream state shows; `idle` and `settled` add nothing to the Door's own Kind. */
const STATE_KIND: Record<NonNullable<RailNode["workstream_state"]>, Kind | undefined> = { "needs-you": "needs-you", error: "error", stalled: "working", working: "working", waiting: "blocked", idle: undefined, settled: undefined };

/** DCL2: the Daemon's Workstream state, as the Kind that glyph shows. A dismissed or quiet failure below no longer reads as urgent. */
const stateKind = (source: RailSource, node: RailNode, dismissed: Dismissed): Kind | undefined => {
  const own = dismissed(node) ? "idle" : node.status?.kind;
  const shown = STATE_KIND[node.workstream_state ?? "idle"];

  if (shown === undefined) return undefined;

  const urgent = shown === "error" || shown === "needs-you";

  return urgent && shown !== own && !agentKindsBelow(source, node.id, dismissed).includes(shown) ? undefined : shown;
};

/** U403, DCL2: the Kind a row's glyph draws: the most urgent of its own Status, a Workstream's state, or, for a folded container, the Agents below it. */
export const rowKind = (source: RailSource, node: RailNode, dismissed: Dismissed, folded: boolean): Kind | null => {
  const container = isWorkstream(node) || node.kind === "group";
  const below = isWorkstream(node) && node.workstream_state !== undefined ? [stateKind(source, node, dismissed)] : container && folded ? agentKindsBelow(source, node.id, dismissed) : [];

  return byUrgency([dismissed(node) ? "idle" as const : node.status?.kind, ...below].filter((kind): kind is Kind => kind !== undefined))[0] ?? null;
};

/** U6228: a mark with no state of its own shows the calm glyph. */
export const markKind = (kind: Kind | null): Kind => kind ?? "idle";

/** U3566, U6119: whether the row, or while it is folded any Agent below it, has a result the user has not seen. */
export const rowUnread = (source: RailSource, node: RailNode, unseen: (id: string) => boolean, folded: boolean): boolean =>
  unseen(node.id) || ((isWorkstream(node) || node.kind === "group") && folded && descendantsOf(source, node.id).some(each => unseen(each.id)));

/** PS12: how many of the row and its Agents below need you or failed, as the Project's count reads them (quiet and dismissed ones excluded). */
export const rowAttention = (source: RailSource, node: RailNode, dismissed: Dismissed) =>
  attentionCounts([node, ...descendantsOf(source, node.id)].filter(each => each.alert_level !== "quiet" && !dismissed(each)));
