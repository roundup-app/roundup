import { copy as appCopy } from "./copy";
import type { Emulator, EmulatorFactory, Size } from "./emulator";

type Loader = () => Promise<EmulatorFactory>;

/** The first Terminal's load and every later Terminal's reuse of it (R3800): xterm stays out of the entry until a Terminal mounts. */
export const lazyEmulators = (load: Loader): EmulatorFactory => {
  let factory: Promise<EmulatorFactory> | undefined;

  return (id, copy) => {
    const created = (factory ??= load());
    let real: Emulator | null = null;
    let disposed = false;
    let size: Size = { cols: 80, rows: 24 };
    const queue: ((emulator: Emulator) => void)[] = [];

    // Calls made before the load run on the real emulator in their order, so replay and input keep the order they arrived in.
    const run = (call: (emulator: Emulator) => void) => {
      if (real) call(real);
      else queue.push(call);
    };

    const ready = created.then((create) => {
      if (disposed) return undefined;

      real = create(id, copy);

      for (const call of queue.splice(0)) call(real);

      return real.ready;
    });

    return {
      prepare: (host, settled, signal) => {
        const waiting = new Promise<Size>((resolve, reject) => run(emulator => {
          if (!emulator.prepare) { reject(new Error(appCopy.terminalPreparationUnavailable));

 return; }

          void emulator.prepare(host, settled, signal).then(resolve, reject);
        }));

        if (!signal) return waiting;
        const cancelled = Promise.withResolvers<never>();
        const abort = () => cancelled.reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });

        if (signal.aborted) abort();

        return Promise.race([waiting, cancelled.promise]).finally(() => signal.removeEventListener("abort", abort));
      },
      bind: next => run(emulator => emulator.bind?.(next)),
      ready,
      write: (bytes, parsed) => run(emulator => emulator.write(bytes, parsed)),
      setSize: (next) => { size = next; run(emulator => emulator.setSize(next)); },
      setFontSize: (next) => run(emulator => emulator.setFontSize(next)),
      reset: () => run(emulator => emulator.reset()),
      onInput: (listener) => run(emulator => emulator.onInput(listener)),
      onLink: (listener) => run(emulator => emulator.onLink(listener)),
      serialize: () => real?.serialize?.() ?? { ...size, data: "" },
      selection: () => real?.selection() ?? "",
      turns: () => real?.turns() ?? [],
      selectTurn: (index, extend) => run(emulator => emulator.selectTurn(index, extend)),
      paste: (text) => run(emulator => emulator.paste(text)),
      show: (host, focus) => {
        if (real) return real.show(host, focus);

        run(emulator => { emulator.show(host, focus); });

        return size;
      },
      focus: () => run(emulator => emulator.focus()),
      fit: () => real?.fit() ?? size,
      onResize: (listener) => run(emulator => emulator.onResize?.(listener)),
      isAtBottom: () => real?.isAtBottom() ?? true,
      onScroll: (listener) => run(emulator => emulator.onScroll(listener)),
      scrollToBottom: () => run(emulator => emulator.scrollToBottom()),
      dispose: () => {
        disposed = true;
        real?.dispose();
      },
    };
  };
};

/** The App's Terminals: xterm and its addons load by native dynamic import on the first one. */
export const lazyXtermEmulators = (): EmulatorFactory =>
  lazyEmulators(() => import("./emulator").then(module => module.createXtermEmulators()));
