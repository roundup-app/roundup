import { Show } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "../copy";
import { createSignal } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import type { ConnectedProject } from "../state/connectedProject";

/** Terminal closure preserves the surviving tab focus and leaves failures on the originating surface. */
export const createTerminalClose = (connected: ConnectedProject, shown: Accessor<readonly TerminalInfo[]>, nameFor: (terminal: TerminalInfo) => string, setFailure: Setter<string | null>) => {
  const { app, rail } = connected;
  const [closing, setClosing] = createSignal<ReadonlySet<string>>(new Set());
  const [retry, setRetry] = createSignal<{ id: string; message: string } | null>(null);

  const close = async (id: string): Promise<void> => {
    if (closing().has(id)) return;

    const active = document.activeElement;
    const controlHeldFocus = active instanceof Element && active.closest("[data-bubble]")?.getAttribute("data-bubble") === id;
    setClosing((ids) => new Set([...ids, id]));

    try {
      const terminal = shown().find(terminal => terminal.id === id);

      if (!terminal) return;
      // Another Terminal's close leaves the held failure and its Retry; a later failure replaces them.
      if (retry() === null || retry()!.id === id) {
        setRetry(null);
        setFailure(null);
      }

      const accepted = await app.ask({ title: copy.closeQuestion(nameFor(terminal)), message: terminal.running ? copy.closeTerminalWarning : copy.closeTerminalOutputWarning, okLabel: copy.close, cancelLabel: copy.keep });

      if (!accepted) {
        if (active instanceof HTMLElement && active.isConnected) active.focus({ preventScroll: true });

        return;
      }

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

      setRetry({ id, message: thrown.message });
      setFailure(thrown.message);
    } finally {
      setClosing((ids) => new Set([...ids].filter((held) => held !== id)));
    }
  };

  const Failure = (props: { message: string | null }) => <ReservedLine overlay class={props.message ? "bubble-failure" : undefined} message={props.message}>
    <Show when={retry()?.message === props.message ? retry() : null}>{failed => <button data-button="quiet" type="button" onClick={() => {
      // Retry starts from the original close control, so cancel and success keep their normal focus destinations.
      document.querySelector<HTMLElement>(`.terminal-tab-pair[data-bubble="${failed().id}"] button:last-child`)?.focus();
      void close(failed().id);
    }}>{copy.retry}</button>}</Show>
  </ReservedLine>;

  return { close, closing, Failure };
};
