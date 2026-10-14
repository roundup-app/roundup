import { copy } from "../copy";
import type { Order } from "@contracts/agent/Order";

const limitsInWords = (count: number): string =>
  count === 0 ? copy.noLimits : count === 1 ? copy.limit : copy.limits(count);

/** O6, Q5: the one line the Workstream shows for an order. */
export const orderLine = (order: Order): string =>
  order.kind === "work"
    ? copy.orderWithLimits(order.ask, limitsInWords(order.limits.length))
    : copy.clarifying(order.question);
