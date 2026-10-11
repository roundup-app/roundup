import type { Order } from "@contracts/agent/Order";

const limitsInWords = (count: number): string =>
  count === 0 ? "no limits" : count === 1 ? "1 limit" : `${count} limits`;

/** O6, Q5: the one line the Workstream shows for an order. */
export const orderLine = (order: Order): string =>
  order.kind === "work"
    ? `${order.ask} · ${limitsInWords(order.limits.length)}`
    : `clarifying: ${order.question}`;
