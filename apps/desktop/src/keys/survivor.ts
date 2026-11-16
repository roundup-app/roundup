const around = (order: readonly string[], pivot: string, kept: (id: string) => boolean) => {
  const at = order.indexOf(pivot);

  return at === -1 ? undefined : { at, after: order.slice(at + 1).find(kept), before: order.slice(0, at).findLast(kept) };
};

/** U3474b, U3474e: the first kept id after `pivot` in the order captured before the change, else the nearest kept one before it, else `pivot` if kept. */
export const afterElseBefore = (order: readonly string[], pivot: string, kept: (id: string) => boolean): string | undefined => {
  const neighbours = around(order, pivot, kept);

  return neighbours && (neighbours.after ?? neighbours.before ?? (kept(pivot) ? pivot : undefined));
};

/** U3751: the kept id nearest to `from` in the order captured before the change; the later one on a tie. */
export const nearest = (order: readonly string[], from: string, kept: (id: string) => boolean): string | undefined => {
  const neighbours = around(order, from, kept);

  if (!neighbours) return undefined;

  if (kept(from)) return from;
  const { at, after, before } = neighbours;

  if (after === undefined || before === undefined) return after ?? before;

  return order.indexOf(after) - at <= at - order.indexOf(before) ? after : before;
};
