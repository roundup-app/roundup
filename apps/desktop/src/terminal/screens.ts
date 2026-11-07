import { throttle } from "@solid-primitives/scheduled";
import { forgetScrollback, retainScrollback } from "./scrollback";
import { copy as appCopy } from "./copy";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { ConnectedProject } from "../state/connectedProject";
import { createClipboard } from "./clipboard";
import { createFailures } from "./failures";
import { createPrepare } from "./prepare";
import { createWatches } from "./watch";
import { createOpener } from "./open";
import { createTyping } from "./typing";
import { createPump, createStream } from "./stream";
import type { Stream } from "./stream";
import type { Emulator, EmulatorFactory, Size, TerminalPreparation } from "./emulator";

export type Screens = {
  prepare(host: HTMLElement, settled?: () => boolean, signal?: AbortSignal): Promise<TerminalPreparation>;
  /** The Terminal's emulator, created on first call; it receives output only while the Terminal is shown. */
  emulatorFor(id: string): Emulator;
  /** Opens a Terminal's emulator in the pane, records the fitted size, and subscribes to its output: the screen is restored, then output follows it. */
  show(id: string, host: HTMLElement, focus?: boolean): Size;
  /** The Terminal leaves the pane: only its output subscription is released, and nothing it still sends reaches the emulator. */
  hide(id: string): void;
  /** Tells the Daemon the size of the Terminal's pane. A Terminal that has exited, or a Daemon that has, takes no resize. */
  resize(id: string, size: Size, changedOnly?: boolean): void;
  setFontSize(size: number): void;
  /**
   * Whether the Terminal's view sits at its newest line; false once the user has scrolled up. Creates the
   * Terminal's emulator if none exists yet (true for that first read), so a caller never needs `emulatorFor`
   * called first for this to stay reactive.
   */
  isAtBottom(id: string): boolean;
  /** Returns the Terminal's view to its newest line, as clicking `↓ latest` or typing (U12) does. */
  returnToBottom(id: string): void;
  copy(id: string): Promise<void>;
  paste(id: string, event: Pick<ClipboardEvent, "clipboardData">): Promise<void>;
  /** Whether the Terminal has exited. */
  exited(id: string): boolean;
  /** Whether a plain Terminal has output its user has not viewed since: it arrived while `viewing(id, false)` applied, and `viewing(id, true)` clears it. */
  unseen(id: string): boolean;
  /** Tells whether the user can see the Terminal now: its Bubble is open and its tab selected. */
  viewing(id: string, on: boolean): void;
  /** Whether `viewing(id, true)` holds: the Terminal's Bubble is open, so that Bubble shows its failure and the pane does not. */
  viewedInBubble(id: string): boolean;
  /** Pastes dropped paths as one shell line fragment (U162); an exited Terminal or Daemon, or no path, takes nothing. */
  pastePaths(id: string, paths: string[]): void;
  /** The selected Terminal's last failed call or `terminal.output`, until a later call for that Terminal succeeds. */
  failure(id: string | null): string | null;
  /** U6249b: the verb that tries the shown failure of `failure(id)` again, or null when it has none. */
  retry(id: string | null): (() => void) | null;
  /** P3557c: the user dismisses the failure `failure(id)` shows; an older failure of that Terminal then shows, and no other Terminal, call or input changes. */
  dismiss(id: string | null): void;
  dispose(): void;
};

type Holder = {
  retain: (() => void) & { clear: () => void };
  ready: boolean;
  incarnation: string | undefined;
  emulator: Emulator;
  host: HTMLElement | null;
  stopClipboard: (() => void) | null;
  atBottom: Accessor<boolean>;
  returnToBottom: () => void;
  stream: Stream | null;
  complete: boolean;
  shownSize: Size | null;
  resizeSize: Size | null;
};

/** `openObject` is the App's one route for a `roundup://` link (AL3); without it the link goes to the OS like any other address. */
export const createScreens = (connected: ConnectedProject, createEmulator: EmulatorFactory, openObject?: (url: string, surface: string) => void): Screens => {
  const { app, rail, daemonExit, project } = connected;
  const holders = new Map<string, Holder>();
  /** The offset up to which a Terminal's output was shown, kept when its stream is released. */
  const shownTo = new Map<string, number>();
  const viewed = new Set<string>();
  const failures = createFailures();
  const attempt = failures.attempt;
  const open = createOpener(connected, failures, openObject);
  let disposed = false;
  const watches = createWatches({ connected, exited: (id) => exited(id), streaming: (id) => !!holders.get(id)?.stream, shownTo, disposed: () => disposed });

  const resize = (id: string, size: Size, changedOnly = true): void => {
    const holder = holders.get(id);

    if (disposed || (holder && !holder.ready)) return;

    if (changedOnly && holder?.resizeSize?.cols === size.cols && holder.resizeSize.rows === size.rows) return;

    if (holder) { holder.shownSize = size; holder.resizeSize = size; }

    if (!exited(id) && daemonExit() === null) void attempt(id, app.rpc("terminal.resize", { id, ...size })).then((delivered) => {
      // A refused size was never delivered; the next host notification can retry it without hiding its failure.
      if (!delivered && holder?.resizeSize === size) holder.resizeSize = null;
    });
  };

  const reflow = (id: string, holder: Holder): void => {
    if (disposed || !holder.ready || !holder.shownSize) return;

    const fitted = holder.emulator.fit();

    if (fitted.cols !== holder.shownSize.cols || fitted.rows !== holder.shownSize.rows) resize(id, fitted);
  };

  const pump = createPump({ connected, failures, watches, viewed, shownTo, exited: (id) => exited(id), acknowledge: (agentId) => connected.held.acknowledge(agentId), reflow });

  const retain = (id: string, holder: Holder, after: number): void => {
    if (!holder.incarnation || !holder.emulator.serialize) return;

    if (exited(id)) {
      forgetScrollback(project.path, holder.incarnation);

      return;
    }

    holder.emulator.write(new Uint8Array(), () => {
      if (disposed) return;
      const output = holder.emulator.serialize?.();

      if (output) retainScrollback(project.path, holder.incarnation!, { ...output, after },
        cause => console.warn(appCopy.terminalOutputNotKept(cause)));
    });
  };

  const release = async (id: string, holder: Holder): Promise<void> => {
    const stream = holder.stream;

    if (!stream) return;

    if (stream.phase.kind === "placed" && stream.after !== null) {
      shownTo.set(id, stream.after);

      if (holder.complete) retain(id, holder, stream.after);
    }

    holder.retain.clear();

    const phase = stream.phase;

    stream.phase = { kind: "released" };
    stream.queue = [];
    holder.stream = null;

    try {
      await (phase.kind === "placed" ? phase.subscription.release() : undefined);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!disposed) console.warn(appCopy.terminalOutputNotWatched(thrown.message));
    }
  };


  const exited = (id: string): boolean => {
    const node = rail.nodes.find((candidate) => candidate.terminal_id === id);

    return node === undefined ? rail.terminalExit(id) !== null : rail.exitOf(node) !== null;
  };

  const isFocused = (id: string): boolean => {
    const active = document.activeElement;
    const host = holders.get(id)?.host;

    return !disposed && !!host?.isConnected && active instanceof HTMLElement
      && host.contains(active) && active.closest<HTMLElement>("[data-terminal]")?.dataset.terminal === id
      && !active.closest("[hidden], [inert]")
      && getComputedStyle(active).visibility !== "hidden";
  };

  const holderFor = (id: string, prepared?: Emulator): Holder => {
    const known = holders.get(id);

    if (known) return known;

    const emulator = prepared ?? createEmulator(id, (text) => clipboard.copy(id, text));

    const [atBottom, setAtBottom] = createSignal(true);
    const type = createTyping(emulator, (data) => attempt(id, app.rpc("terminal.write", { id, data })));

    const returnToBottom = () => {
      emulator.scrollToBottom();
      setAtBottom(true);
    };

    emulator.onLink((printed) => void open(id, printed));
    emulator.onScroll(() => setAtBottom(emulator.isAtBottom()));
    emulator.onInput((bytes, userInput = true) => {
      if ((userInput && !isFocused(id)) || exited(id) || daemonExit() !== null) return;

      if (userInput) returnToBottom();

      type(bytes, userInput);
    });

    const holder: Holder = {
      retain: throttle(() => {
        const after = holder.stream?.after;

        if (after != null) retain(id, holder, after);
      }, 2000),
      host: null, emulator, ready: !emulator.ready, incarnation: rail.terminals().find(terminal => terminal.id === id)?.incarnation, stopClipboard: null, atBottom, returnToBottom, stream: null, complete: false, shownSize: null, resizeSize: null,
    };

    holders.set(id, holder);
    emulator.onResize?.((size) => {
      if (holder.stream) resize(id, size);
    });

    void emulator.ready?.then(() => {
      if (disposed) return;

      holder.ready = true;

      if (holder.shownSize && holder.stream) resize(id, holder.emulator.fit());
    }).catch(console.error);

    return holder;
  };

  const emulatorFor = (id: string): Emulator => holderFor(id).emulator;
  const clipboard = createClipboard({ connected, failures, emulatorFor, exited, isFocused });

  const show = (id: string, host: HTMLElement, focus?: boolean): Size => {
    const holder = holderFor(id);
    const agent = rail.nodes.find(node => node.terminal_id === id);

    holder.stopClipboard?.();
    holder.host = host;
    holder.stopClipboard = clipboard.listen(id, host);

    const size = holder.emulator.show(host, focus);

    holder.shownSize = size;

    if (!holder.stream) {
      const stream = createStream();

      holder.stream = stream;
      void pump.attach(id, holder, stream);
    } else if (agent && rail.shouldAcknowledgeAlerts() && holder.complete && holder.stream.after !== null && !holder.stream.lost && rail.selected() === agent.id) {
      connected.held.acknowledge(agent.id);
    }

    return size;
  };

  const hide = (id: string): void => {
    const holder = holders.get(id);

    holder?.stopClipboard?.();
    holder?.emulator.blur?.();

    if (holder) {
      holder.host = null;
      void release(id, holder).then(watches.reconcile);
    }
  };

  return {
    prepare: createPrepare({ createEmulator, copy: clipboard.copy, adopt: (id, emulator) => void holderFor(id, emulator) }),
    emulatorFor,
    show,
    hide,
    resize,
    setFontSize: (size) => {
      for (const holder of holders.values()) holder.emulator.setFontSize(size);
    },
    isAtBottom: (id) => holderFor(id).atBottom(),
    returnToBottom: (id) => holderFor(id).returnToBottom(),
    copy: clipboard.copy,
    paste: clipboard.paste,
    pastePaths: clipboard.pastePaths,
    exited,
    unseen: watches.unseen,
    viewedInBubble: watches.bubbled,
    viewing: (id, on) => {
      watches.setBubbled(id, on);

      if (on) {
        viewed.add(id);
        watches.markUnseen(id, false);
      } else {
        viewed.delete(id);
        holders.get(id)?.emulator.blur?.();
      }
    },
    failure: (id) => failures.shown(id)?.entry.message ?? null,
    retry: (id) => failures.shown(id)?.entry.retry ?? null,
    dismiss: failures.dismiss,
    dispose: () => {
      disposed = true;

      watches.stopAll();

      for (const [id, holder] of holders) {
        void release(id, holder);
        holder.stopClipboard?.();
        holder.retain.clear();
        holder.emulator.dispose();
      }

      holders.clear();
    },
  };
};
