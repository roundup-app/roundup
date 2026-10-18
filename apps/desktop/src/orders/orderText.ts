import { copy } from "../copy";
import type { Order } from "@contracts/agent/Order";

const limitsInWords = (count: number): string =>
  count === 0 ? copy.noLimits : count === 1 ? copy.limit : copy.limits(count);

/** O6, Q5: the one line the Workstream shows for an order; `null` for the Daemon's placeholder question, which no one asked (O17). */
export const orderLine = (order: Order): string | null =>
  order.kind === "work"
    ? copy.orderWithLimits(order.ask, limitsInWords(order.limits.length))
    : order.question === copy.defaultQuestion
      ? null
      : copy.clarifying(order.question);
