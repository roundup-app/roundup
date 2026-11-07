import { createListCollection } from "@ark-ui/solid/collection";

const walk = (order: readonly string[], kept: (id: string) => boolean) => createListCollection({
  items: [...order], itemToValue: id => id, itemToString: id => id, isItemDisabled: id => !kept(id),
});

/** U3474b, U3474e: the first kept id after `pivot` in the order captured before the change, else the nearest kept one before it, else `pivot` if kept. */
export const afterElseBefore = (order: readonly string[], pivot: string, kept: (id: string) => boolean): string | undefined => {
  const rows = walk(order, kept);

  return rows.getNextValue(pivot) ?? rows.getPreviousValue(pivot) ?? (order.includes(pivot) && kept(pivot) ? pivot : undefined);
};

/** U3751: the kept id nearest to `from` in the order captured before the change; the later one on a tie. */
export const nearest = (order: readonly string[], from: string, kept: (id: string) => boolean): string | undefined => {
  if (order.includes(from) && kept(from)) return from;
  const rows = walk(order, kept);
  const after = rows.getNextValue(from) ?? undefined;
  const before = rows.getPreviousValue(from) ?? undefined;

  if (after === undefined || before === undefined) return after ?? before;

  return order.indexOf(after) - order.indexOf(from) <= order.indexOf(from) - order.indexOf(before) ? after : before;
};
