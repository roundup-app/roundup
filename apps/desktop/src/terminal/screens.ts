import { throttle } from "@solid-primitives/scheduled";
import { forgetScrollback, restoreScrollback, retainScrollback } from "./scrollback";
import { copy as appCopy } from "./copy";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { OutputMessage, OutputSubscription } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import { fromBase64 } from "./base64";
import { createClipboard } from "./clipboard";
import { createFailures } from "./failures";
import { createPrepare } from "./prepare";
import { createWatches } from "./watch";
import { createOpener } from "./open";
import { createTyping } from "./typing";
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

/** Bytes buffered for one Terminal while its screen is fetched; past this the oldest go and the screen is fetched again. */
const MAX_BUFFERED_BYTES = 1_048_576;

/** A parse cannot be interrupted, so a chunk is sized to take about this long: a typed echo waits behind at most one. */
const TARGET_PARSE_MS = 2;

const MIN_CHUNK_BYTES = 512;

const MAX_CHUNK_BYTES = 8192;

/** One output subscription of a displayed Terminal, and the stream state that belongs to it alone. */
type Stream = {
  open: boolean;
  subscription: OutputSubscription | null;
  /** Messages that arrived before the subscription's first offset was known. */
  early: OutputMessage[];
  placed: boolean;
  start: number | null;
  /** The offset the next byte of the stream gets. */
  position: number;
  queue: { offset: number; bytes: Uint8Array }[];
  queued: number;
  /** The offset the emulator has been written up to; null until the first screen. */
  after: number | null;
  restoring: boolean;
  parsing: boolean;
  /** Bytes the next chunk may hold, from how fast the last one parsed. */
  chunk: number;
  lost: boolean;
};

const takeFirst = (stream: Stream): void => {
  const chunk = stream.queue.shift();

  if (chunk) stream.queued -= chunk.bytes.length;
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

  const drain = (id: string, holder: Holder, stream: Stream): void => {
    if (stream.restoring || stream.parsing || stream.after === null || !stream.open) return;

    while (stream.queue.length > 0) {
      const chunk = stream.queue[0];

      if (!chunk) return;

      const end = chunk.offset + chunk.bytes.length;

      if (end <= stream.after) {
        takeFirst(stream);

        continue;
      }

      if (chunk.offset > stream.after) {
        void restore(id, holder, stream);

        return;
      }

      let bytes = chunk.bytes.subarray(stream.after - chunk.offset, stream.after - chunk.offset + stream.chunk);

      stream.after += bytes.length;

      if (stream.after === end) takeFirst(stream);

      // Small output events share the same parse budget; one event per frame
      // would stretch an ordinary burst over hundreds of frames (X14).
      if (bytes.length < stream.chunk && stream.queue[0]?.offset === stream.after) {
        const combined = new Uint8Array(Math.min(stream.chunk, bytes.length + stream.queued));
        let length = bytes.length;

        combined.set(bytes);

        while (length < combined.length) {
          const next: Stream["queue"][number] | undefined = stream.queue[0];

          if (!next || next.offset !== stream.after) break;

          const part = next.bytes.subarray(0, combined.length - length);

          combined.set(part, length);
          length += part.length;
          stream.after += part.length;

          if (part.length === next.bytes.length) takeFirst(stream);
          else break;
        }

        bytes = combined.subarray(0, length);
      }

      stream.parsing = true;

      const started = performance.now();

      try {
        holder.emulator.write(bytes, () => {
          holder.retain();

          const took = performance.now() - started;

          if (took > 0) stream.chunk = Math.round(Math.min(MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, bytes.length * TARGET_PARSE_MS / took)));

          // R21: the Mac flood trace at f464337 spends 13 ms p95 parsed→frame.
          // Yield to rendering between backlog chunks: timer-only rests can start
          // several parses before a frame. xterm schedules the next write's parse
          // in a task, after this frame's render callbacks have run.
          if (stream.queue.length > 0) requestAnimationFrame(() => {
            stream.parsing = false;

            if (stream.open && holder.stream === stream) settle(id, holder, stream);
          });
          else {
            stream.parsing = false;

            // A gap delivered during the parse found `settle` returning early; nothing else will start its restore.
            if (stream.lost && stream.open && holder.stream === stream) settle(id, holder, stream);
          }
        });
      } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown;

        stream.parsing = false;
        failures.set(id, "output", appCopy.terminalOutputStopped(thrown.message));
      }

      if (stream.parsing) return;
    }
  };

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

  const restore = async (id: string, holder: Holder, stream: Stream): Promise<void> => {
    if (stream.restoring || !stream.open) return;

    stream.restoring = true;

    try {
      const retained = await restoreScrollback(
        connected, id, holder.incarnation, holder.emulator, holder.complete, shownTo.get(id),
        () => stream.open && stream.after === null && !stream.lost,
        cause => console.warn(appCopy.terminalOutputNotKept(cause)),
      );

      if (!stream.open) return;

      if (retained !== null) {
        stream.after = retained;
        requestAnimationFrame(() => reflow(id, holder));
      }

      if (retained === null) {
        const snapshot = await app.rpc("terminal.snapshot", { id });

        if (!stream.open) return;

        if (holder.complete) holder.emulator.reset();

        holder.emulator.setSize({ cols: snapshot.cols, rows: snapshot.rows });
        holder.emulator.write(fromBase64(snapshot.data), () => requestAnimationFrame(() => reflow(id, holder)));

        stream.after = snapshot.after;
      }

      holder.complete = true;
      holder.retain();
      failures.set(id, "snapshot", null);
      const agent = rail.nodes.find(node => node.terminal_id === id);

      if (agent && rail.shouldAcknowledgeAlerts() && rail.selected() === agent.id) connected.held.acknowledge(agent.id);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!stream.open) return;

      failures.set(id, "snapshot", appCopy.terminalRestoreFailed(thrown.message), () => {
        if (stream.open && !stream.restoring) void restore(id, holder, stream);
      });

      if (!holder.complete) stream.after = stream.queue[0]?.offset ?? stream.start ?? 0;

      stream.restoring = false;

      if (!holder.complete) drain(id, holder, stream);

      return;
    }

    stream.restoring = false;

    if (stream.lost) {
      stream.lost = false;
      void restore(id, holder, stream);
    } else {
      drain(id, holder, stream);
    }
  };

  /** Bytes get the offsets the stream's contiguous positions give them; a gap drops what was queued and asks for a fresh snapshot. */
  const place = (stream: Stream, message: OutputMessage): void => {
    if ("gap" in message) {
      stream.queue = [];
      stream.queued = 0;
      stream.position = message.gap.to;
      stream.lost = true;

      return;
    }

    stream.queue.push({ offset: stream.position, bytes: message });
    stream.position += message.length;
    stream.queued += message.length;

    while (stream.queued > MAX_BUFFERED_BYTES) {
      takeFirst(stream);
      stream.lost = true;
    }
  };

  const settle = (id: string, holder: Holder, stream: Stream): void => {
    if (stream.parsing) return;

    if (stream.lost && !stream.restoring) {
      stream.lost = false;
      void restore(id, holder, stream);
    } else {
      drain(id, holder, stream);
    }
  };

  const receive = (id: string, holder: Holder, stream: Stream, message: OutputMessage): void => {
    // A callback that outlives its subscription (released, replaced or disposed) reaches nothing.
    if (!stream.open || holder.stream !== stream) return;

    if (!("gap" in message)) holder.emulator.outputArrived?.(message);

    if (!stream.placed) {
      stream.early.push(message);

      return;
    }

    if (!viewed.has(id)) watches.markUnseen(id, true);

    place(stream, message);
    settle(id, holder, stream);
  };

  /** Installs the Terminal's output subscription first, then asks for its screen, so no byte falls between them. */
  const attach = async (id: string, holder: Holder, stream: Stream): Promise<void> => {
    try {
      if (watches.watching(id)) await watches.stop(id);

      if (!exited(id)) {
        failures.set(id, "output", null);

        const subscription = await watches.subscribe(id, (message) => receive(id, holder, stream, message), () => stream.open);

        if (!stream.open || subscription === null) {
          await subscription?.release();

          return;
        }

        stream.subscription = subscription;
        stream.start = subscription.offset;
        stream.position = subscription.offset;
        stream.placed = true;

        for (const message of stream.early.splice(0)) place(stream, message);
      }
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!stream.open) return;

      failures.set(id, "output", appCopy.terminalOutputStopped(thrown.message), () => {
        if (stream.open) void attach(id, holder, stream);
      });
    }

    if (stream.open) void restore(id, holder, stream);
  };

  const release = async (id: string, holder: Holder): Promise<void> => {
    const stream = holder.stream;

    if (!stream) return;

    if (stream.placed && stream.after !== null) {
      shownTo.set(id, stream.after);

      if (holder.complete) retain(id, holder, stream.after);
    }

    holder.retain.clear();

    stream.open = false;
    stream.queue = [];
    stream.early = [];
    holder.stream = null;

    try {
      await stream.subscription?.release();
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
      if (holder.stream?.open) resize(id, size);
    });

    void emulator.ready?.then(() => {
      if (disposed) return;

      holder.ready = true;

      if (holder.shownSize && holder.stream?.open) resize(id, holder.emulator.fit());
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
      const stream: Stream = {
        open: true, subscription: null, early: [], placed: false, start: null, position: 0,
        queue: [], queued: 0, after: null, restoring: false, parsing: false, chunk: MAX_CHUNK_BYTES, lost: false,
      };

      holder.stream = stream;
      void attach(id, holder, stream);
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
