import { createEffect, createMemo, createSignal } from "solid-js";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";

type Terminal = Readonly<Pick<TerminalInfo, "id" | "incarnation">>;

type Item = { kind: "rail"; id: string | null } | { kind: "terminal"; terminal: Terminal };

/** P3557c: one failure line about at most one item. It goes when that item is gone, when a later save of it is acknowledged, or when dismissed; a failure with no item stays until `clear`. */
export const createItemFailure = (exists: (item: string) => boolean, terminals: () => readonly Terminal[] = () => []) => {
  const [state, setState] = createSignal<{ message: string; item: Item; surface: "rail" | "pane"; retry: (() => void) | null } | null>(null);

  const live = () => {
    const current = state();

    if (current === null) return null;
    const item = current.item;

    return (item.kind === "rail" ? item.id === null || exists(item.id) : terminals().some(terminal => terminal.id === item.terminal.id && terminal.incarnation === item.terminal.incarnation)) ? current : null;
  };

  createEffect(createMemo(() => state() !== null && live() === null), gone => {
    if (gone) setState(null);
  });

  return {
    message: () => live()?.message ?? null,
    surface: () => live()?.surface ?? null,
    retry: () => live()?.retry ?? null,
    show: (message: string, item: string | null = null, surface: "rail" | "pane" = "rail", retry: (() => void) | null = null) => setState({ message, item: { kind: "rail", id: item }, surface, retry }),
    /** Terminal and Rail ids are separate namespaces; retain the original incarnation even if the caller's facts change. */
    showTerminal: (message: string, terminal: Terminal, surface: "rail" | "pane" = "pane", retry: (() => void) | null = null) => setState({ message, item: { kind: "terminal", terminal: { id: terminal.id, incarnation: terminal.incarnation } }, surface, retry }),
    /** An acknowledged save, or any success, of `item` clears only a failure about it. */
    acknowledge: (item: string | null) => setState(current => current?.item.kind === "rail" && current.item.id === item ? null : current),
    acknowledgeTerminal: (terminal: Terminal) => setState(current => current?.item.kind === "terminal" && current.item.terminal.id === terminal.id && current.item.terminal.incarnation === terminal.incarnation ? null : current),
    clear: () => setState(null),
  };
};
