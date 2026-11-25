import type { captureFocus } from "../keys/focus";
import type { RailNode } from "@contracts/agent/RailNode";

/** U7916: the rows the user added whose ids `rail.tree` has not shown yet. A row is selected once the tree holds it, unless the user picked another row after the add began (`picks` counts picks). */
export const createWantedRows = (tree: () => readonly RailNode[], picks: () => number, select: (id: string, focus: ReturnType<typeof captureFocus>) => void) => {
  let wanted: { id: string; since: number; focus: ReturnType<typeof captureFocus> }[] = [];

  const settle = (shown: readonly RailNode[] = tree()) => {
    const ready = wanted.filter(row => shown.some(node => node.id === row.id));

    if (ready.length === 0) return;
    wanted = wanted.filter(row => !ready.includes(row));

    for (const row of ready) if (picks() === row.since) select(row.id, row.focus);
  };

  return {
    settle,
    want: (id: string, since: number, focus: ReturnType<typeof captureFocus>) => {
      wanted.push({ id, since, focus });
      settle();
    },
  };
};
