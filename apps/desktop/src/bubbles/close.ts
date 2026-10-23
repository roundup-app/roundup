import { createSignal } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import type { ConnectedProject } from "../state/connectedProject";

/** Terminal closure preserves the surviving tab focus and leaves failures on the originating surface. */
export const createTerminalClose = (connected: ConnectedProject, shown: Accessor<readonly TerminalInfo[]>, setFailure: Setter<string | null>) => {
  const { app, rail } = connected;
  const [closing, setClosing] = createSignal<ReadonlySet<string>>(new Set());

  const close = async (id: string): Promise<void> => {
    if (closing().has(id)) return;

    const active = document.activeElement;
    const controlHeldFocus = active instanceof Element && active.closest("[data-bubble]")?.getAttribute("data-bubble") === id;
    setClosing((ids) => new Set([...ids, id]));

    try {
      await app.rpc("terminal.close", { id });
      await rail.refresh({ terminals: true });
      setFailure(null);

      if (controlHeldFocus) queueMicrotask(() => {
        const remaining = shown();
        const nextId = remaining.find((terminal) => Number(terminal.id) > Number(id))?.id ?? remaining.at(-1)?.id;
        const control = nextId === undefined ? document.querySelector<HTMLElement>('.terminal-new') : document.querySelector<HTMLElement>(`.terminal-tab[data-bubble="${nextId}"]`);
        control?.focus();
      });
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(thrown.message);
    } finally {
      setClosing((ids) => new Set([...ids].filter((held) => held !== id)));
    }
  };

  return { close, closing };
};
