import type { Account } from "@contracts/agent/Account";
import type { Rank } from "@contracts/agent/Rank";
import { copy } from "./copy";
import type { FileRanks, Grouped, RiskMark } from "./modules";

const ORDER: readonly Rank[] = ["core", "forced", "glue"];

/** U7689b: the path of a hunk id, `<path>#<n>`: the diff reader counts hunks differently, so only the path is sound. */
const pathOf = (hunk: string) => hunk.slice(0, hunk.lastIndexOf("#"));

/** U7697a: each path's best rank over its hunks (core before forced before glue); a path with no ranked hunk is absent. */
export const fileRanks = (account: Account | undefined): FileRanks | undefined => {
  if (!account) return undefined;

  const best = new Map<string, number>();

  for (const { hunk, rank } of account.ranks) {
    const path = pathOf(hunk);
    const at = ORDER.indexOf(rank);

    if (at < (best.get(path) ?? ORDER.length)) best.set(path, at);
  }

  return best;
};

/** U7697a: the word of a path's rank, shown in its header while the rank order is in force. */
export const rankWord = (ranks: FileRanks | undefined, path: string): string | undefined => {
  const at = ranks?.get(path);

  return at === undefined ? undefined : copy.rankWord[ORDER[at] ?? "glue"];
};

/** U7697c: the mark of a flow's or module's risk when it is high or medium; low gives none. */
export const riskOf = (account: Account | undefined, target: "flow" | "module", id: string, stale: boolean): RiskMark | undefined => {
  const risk = account?.risks.find(each => each.target === target && each.id === id);

  return risk && risk.level !== "low" ? { level: risk.level, reason: risk.reason, stale } : undefined;
};

/** U7697c: each module of a lens carries its risk. */
export const withRisks = (grouped: Grouped, account: Account | undefined, stale: boolean): Grouped => account ? { ...grouped, modules: grouped.modules.map(module => {
  const risk = riskOf(account, "module", module.name, stale);

  return risk ? { ...module, risk } : module;
}) } : grouped;
