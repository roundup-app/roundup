import { createEffect, createSignal } from "solid-js";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";

/** Strings identify Rail rows; Terminal ids occupy a separate namespace and require their incarnation. */
type Item = string | Readonly<Pick<TerminalInfo, "id" | "incarnation">> | null;

/** P3557c: one failure line about at most one item. It goes when that item is gone, when a later save of it is acknowledged, or when dismissed; a failure with no item stays until `clear`. */
export const createItemFailure = (exists: (item: string) => boolean, terminals: () => readonly Pick<TerminalInfo, "id" | "incarnation">[] = () => []) => {
  const [state, setState] = createSignal<{ message: string; item: Item; surface: "rail" | "pane"; retry: (() => void) | null } | null>(null);

  const live = () => {
    const current = state();

    if (current === null) return null;
    const item = current.item;

    return item === null || (typeof item === "string" ? exists(item) : terminals().some(terminal => terminal.id === item.id && terminal.incarnation === item.incarnation)) ? current : null;
  };

  createEffect(() => {
    if (state() !== null && live() === null) setState(null);
  });

  return {
    message: () => live()?.message ?? null,
    surface: () => live()?.surface ?? null,
    retry: () => live()?.retry ?? null,
    show: (message: string, item: Item = null, surface: "rail" | "pane" = "rail", retry: (() => void) | null = null) => setState({ message, item: item !== null && typeof item !== "string" ? { id: item.id, incarnation: item.incarnation } : item, surface, retry }),
    /** An acknowledged save, or any success, of `item` clears only a failure about it. */
    acknowledge: (item: Item) => {
      const prior = state()?.item;

      if (prior === item || (prior != null && item !== null && typeof prior !== "string" && typeof item !== "string" && prior.id === item.id && prior.incarnation === item.incarnation)) setState(null);
    },
    clear: () => setState(null),
  };
};
