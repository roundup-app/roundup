import type { RailNode } from "@contracts/agent/RailNode";

const STEM = "New Workstream";

/** U167: the first free name of `New Workstream`, `New Workstream 2`… among the Rail's root rows. */
export const defaultWorkstreamName = (nodes: readonly RailNode[]): string => {
  const taken = new Set(nodes.flatMap((node) => (node.parent === null ? [node.name] : [])));

  for (let n = 1; ; n += 1) {
    const name = n === 1 ? STEM : `${STEM} ${n}`;

    if (!taken.has(name)) return name;
  }
};
