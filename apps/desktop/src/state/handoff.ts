import type { RailNode } from "@contracts/agent/RailNode";

type Row = Pick<RailNode, "id" | "kind" | "parent">;

/**
 * H7200d: the row that takes the selection when the selected Agent `gone` leaves the Rail, or `null`.
 * A builder stands ahead of the Agent that handed off until that Agent ends, then at its index, so
 * the taker is a sibling that arrived after the selection (`seen` lists the rows when it was made)
 * either just ahead of `gone` or at its index once `gone` is out of the list.
 */
export const handoffTaker = (before: readonly Row[], after: readonly Row[], gone: string, seen: ReadonlySet<string>): string | null => {
  const old = before.find(row => row.id === gone);

  if (!old || old.kind !== "agent") return null;

  const was = before.flatMap(row => row.parent === old.parent ? [row.id] : []);
  const now = after.flatMap(row => row.parent === old.parent && row.kind === "agent" ? [row.id] : []);
  const at = was.indexOf(gone);
  const ahead = was[at - 1];

  if (ahead !== undefined && !seen.has(ahead) && now.includes(ahead)) return ahead;

  const standing = after.filter(row => row.parent === old.parent)[at];

  return standing !== undefined && standing.kind === "agent" && !seen.has(standing.id) ? standing.id : null;
};
