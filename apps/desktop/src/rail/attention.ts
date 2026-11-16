import type { RailNode } from "@contracts/agent/RailNode";
import type { Status } from "@contracts/Status";
import { isDoor, type DoorNode } from "../state/doorNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";

/** U5151c, U7189: whether the owner dismissed the node's current failure, or has seen the Terminal's current status. */
export type Dismissed = (item: RailNode | TerminalInfo) => boolean;

const none: Dismissed = () => false;

/** A node's Status; a Group has none. */
export const statusOf = (node: RailNode): Status | null => isDoor(node) ? node.status : null;

/** What counts toward attention: a node or Terminal, whose Status may be absent (a Group has none). */
export type Holder = { status?: Status | null; alert_level?: RailNode["alert_level"] };

/** U5502, U7189: whether a node may raise attention at all: a Door that is not Quiet and, for a Workstream, has had an Attempt. */
export const raisesAttention = (node: RailNode): node is DoorNode => isDoor(node) && node.alert_level !== "quiet" && !(node.kind === "workstream" && node.attempt === null);

/** U7189: one thing that needs the user: an Agent or Door, or a Terminal no node holds as its pane, whose program reported `needs-you` or `error`. */
export type AttentionEntry = { kind: "agent"; node: DoorNode; status: Status } | { kind: "terminal"; terminal: TerminalInfo; status: Status };

/** Whether a Status needs the user: Kind `needs-you` or `error`. */
const isUrgent = (status: Status | null | undefined): status is Status => status?.kind === "error" || status?.kind === "needs-you";

/**
 * U7189: the one list the Dock badge, the menu bar's Waiting rows, the Project tab's counts, the Rail's counts, Needs you and Jump read: the nodes that may raise attention whose Kind is `needs-you` or an `error` not dismissed,
 * then the Terminals that need you (PS11.1; an Agent's own screen counts through the Agent) until the owner has seen them.
 */
export const attentionList = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[], dismissed: Dismissed = none): AttentionEntry[] => {
  const panes = new Set(nodes.flatMap((node) => !isDoor(node) || node.terminal_id === null ? [] : [node.terminal_id]));

  return [
    ...nodes.flatMap((node): AttentionEntry[] => raisesAttention(node) && isUrgent(node.status) && !dismissed(node) ? [{ kind: "agent", node, status: node.status }] : []),
    ...terminals.flatMap((terminal): AttentionEntry[] => !panes.has(terminal.id) && isUrgent(terminal.status) && !dismissed(terminal) ? [{ kind: "terminal", terminal, status: terminal.status }] : []),
  ];
};

/** U7189: the entries of `attentionList`, most urgent first: Kind `error` before `needs-you`, then the oldest Status. */
export const attentionOrder = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[], dismissed: Dismissed = none): AttentionEntry[] =>
  attentionList(nodes, terminals, dismissed).sort((a, b) => Number(a.status.kind !== "error") - Number(b.status.kind !== "error") || a.status.since - b.status.since);

/** The first Agent of `attentionOrder` when `selected` is not in it; otherwise the next, wrapping after the last. `null` when no Agent needs you; a Terminal opens from its row (U7189b). */
export const nextAttention = (nodes: readonly RailNode[], selected: string | null, dismissed: Dismissed = none): RailNode | null => {
  const order = attentionOrder(nodes, [], dismissed).flatMap((entry) => entry.kind === "agent" ? [entry.node] : []);
  const at = order.findIndex((node) => node.id === selected);

  return order[(at + 1) % order.length] ?? null;
};

/** PS12, U7189: what counts toward attention in one Project: the nodes that may raise attention and their Terminals that need you, so the count, the Dock badge and Needs you agree. */
export const attentionHolders = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[], dismissed: Dismissed = none): Holder[] => [
  ...nodes.filter((node) => raisesAttention(node) && !dismissed(node)),
  ...attentionList(nodes, terminals, dismissed).flatMap((entry) => entry.kind === "terminal" ? [entry.terminal] : []),
];

/** How many holders of each attention Kind (U182's tooltip reads both). */
export const attentionCounts = (holders: readonly Holder[]) => {
  const kinds = holders.map((holder) => holder.status?.kind);

  return { needsYou: kinds.filter((kind) => kind === "needs-you").length, error: kinds.filter((kind) => kind === "error").length };
};
