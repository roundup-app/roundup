import { clipboardFailure, readPaste, writeText } from "../app/clipboard";
import { copy as appCopy } from "../copy";
import { createEffect, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { RpcError } from "../app/seam";
import type { OutputMessage, OutputSubscription } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import { fromBase64, toBase64 } from "./base64";
import { absolutePath } from "./links";
import type { Printed } from "./links";
import type { Emulator, EmulatorFactory, Size } from "./emulator";

export type Screens = {
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
  /** P3557c: the user dismisses the failure `failure(id)` shows; an older failure of that Terminal then shows, and no other Terminal, call or input changes. */
  dismiss(id: string): void;
  dispose(): void;
};

/** Bytes buffered for one Terminal while its screen is fetched; past this the oldest go and the screen is fetched again. */
const MAX_BUFFERED_BYTES = 1_048_576;

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
  lost: boolean;
};

/** One Terminal's output subscription that exists only to learn that bytes came: the first one ends it. */
type Watch = { open: boolean; subscription: OutputSubscription | null };

const takeFirst = (stream: Stream): void => {
  const chunk = stream.queue.shift();

  if (chunk) stream.queued -= chunk.bytes.length;
};

type Holder = {
  ready: boolean;
  emulator: Emulator;
  stopClipboard: (() => void) | null;
  atBottom: Accessor<boolean>;
  returnToBottom: () => void;
  stream: Stream | null;
  complete: boolean;
  shownSize: Size | null;
};

type FailureEntry = { message: string; order: number };

/** `output` is the subscription's own failure: a later successful call does not clear it, only a new subscription does. */
type TerminalFailures = { snapshot: FailureEntry | null; live: FailureEntry | null; output: FailureEntry | null; clipboard: FailureEntry | null; link: FailureEntry | null };

const FAILURE_KINDS = ["snapshot", "live", "output", "clipboard", "link"] as const;

const newestFailure = (state: TerminalFailures | undefined): FailureEntry | null => {
  if (!state) return null;

  return [state.snapshot, state.live, state.output, state.clipboard, state.link].reduce<FailureEntry | null>(
    (latest, entry) => entry && (!latest || entry.order > latest.order) ? entry : latest,
    null,
  );
};

const NOT_FOUND = -32001;

export const createScreens = (connected: ConnectedProject, createEmulator: EmulatorFactory): Screens => {
  const { app, rail, daemonExit, project } = connected;
  const holders = new Map<string, Holder>();
  const watches = new Map<string, Watch>();
  /** The offset up to which a Terminal's output was shown, kept when its stream is released. */
  const shownTo = new Map<string, number>();
  const viewed = new Set<string>();
  const [bubbled, setBubbled] = createSignal(new Set<string>());
  const [unseenIds, setUnseenIds] = createSignal<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = createSignal(new Map<string, TerminalFailures>());
  let failureOrder = 0;
  let disposed = false;

  const setFailure = (id: string, kind: keyof TerminalFailures, message: string | null): void => {
    setFailures((current) => {
      const previous = current.get(id) ?? { snapshot: null, live: null, output: null, clipboard: null, link: null };

      if (message === null && previous[kind] === null) return current;

      const state: TerminalFailures = {
        ...previous,
        [kind]: message === null ? null : { message, order: ++failureOrder },
      };

      const next = new Map(current);

      next.delete(id);

      if (state.snapshot !== null || state.live !== null || state.output !== null || state.clipboard !== null || state.link !== null) next.set(id, state);

      return next;
    });
  };

  const resize = (id: string, size: Size, changedOnly = false): void => {
    const holder = holders.get(id);

    if (holder && !holder.ready) return;

    if (changedOnly && holder?.shownSize?.cols === size.cols && holder.shownSize.rows === size.rows) return;

    if (holder?.shownSize) holder.shownSize = size;

    if (!exited(id) && daemonExit() === null) void attempt(id, app.rpc("terminal.resize", { id, ...size }));
  };

  const reflow = (id: string, holder: Holder): void => {
    if (disposed || !holder.ready || !holder.shownSize) return;

    const fitted = holder.emulator.fit();

    if (fitted.cols !== holder.shownSize.cols || fitted.rows !== holder.shownSize.rows) resize(id, fitted);
  };

  const markUnseen = (id: string, on: boolean): void => {
    setUnseenIds((current) => {
      if (current.has(id) === on) return current;

      const next = new Set(current);

      if (on) next.add(id);
      else next.delete(id);

      return next;
    });
  };

  const stopWatch = async (id: string): Promise<void> => {
    const watch = watches.get(id);

    if (!watch) return;

    watch.open = false;
    watches.delete(id);

    try {
      await watch.subscription?.release();
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!disposed) setFailure(id, "output", `terminal.output: ${thrown.message}`);
    }
  };

  /** Bytes the watch missed between the stream's release and its own start (`offset` past `shownTo`) count as unseen too. */
  const startWatch = (id: string): void => {
    const watch: Watch = { open: true, subscription: null };
    const seen = shownTo.get(id);

    watches.set(id, watch);

    void (async () => {
      try {
        const subscription = await app.selectOutput(id, () => {
          if (!watch.open) return;

          markUnseen(id, true);
          void stopWatch(id);
        });

        if (!watch.open) {
          await subscription.release();

          return;
        }

        watch.subscription = subscription;

        if (seen !== undefined && subscription.offset > seen) {
          markUnseen(id, true);
          await stopWatch(id);
        }
      } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown;

        if (watch.open) setFailure(id, "output", `terminal.output: ${thrown.message}`);
      }
    })();
  };

  /** A plain Terminal no one is streaming gets a watch until it is unseen; a Door's or Agent's Terminal, an exited one and one already unseen get none. */
  const reconcile = (): void => {
    const panes = new Set(rail.nodes.flatMap((node) => node.terminal_id === null ? [] : [node.terminal_id]));
    const wanted = new Set(rail.terminals().filter((terminal) => !panes.has(terminal.id)).map((terminal) => terminal.id));

    for (const id of [...watches.keys()]) {
      if (!wanted.has(id) || exited(id)) void stopWatch(id);
    }

    for (const id of wanted) {
      if (!holders.get(id)?.stream && !watches.has(id) && !unseenIds().has(id) && !exited(id)) startWatch(id);
    }

    setUnseenIds((current) => [...current].every((id) => wanted.has(id)) ? current : new Set([...current].filter((id) => wanted.has(id))));
  };

  createEffect(reconcile);

  const drain = (id: string, holder: Holder, stream: Stream): void => {
    if (stream.restoring || stream.after === null || !stream.open) return;

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

      try {
        holder.emulator.write(chunk.bytes.subarray(stream.after - chunk.offset));
      } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown;

        setFailure(id, "output", `terminal.output: ${thrown.message}`);
      }

      stream.after = end;
      takeFirst(stream);
    }
  };

  const restore = async (id: string, holder: Holder, stream: Stream): Promise<void> => {
    if (stream.restoring || !stream.open) return;

    stream.restoring = true;

    try {
      const snapshot = await app.rpc("terminal.snapshot", { id });

      if (!stream.open) return;

      const bytes = fromBase64(snapshot.data);

      if (holder.complete) holder.emulator.reset();

      holder.emulator.setSize({ cols: snapshot.cols, rows: snapshot.rows });
      holder.emulator.write(bytes, () => requestAnimationFrame(() => reflow(id, holder)));
      stream.after = snapshot.after;
      holder.complete = true;
      setFailure(id, "snapshot", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!stream.open) return;

      setFailure(id, "snapshot", `terminal.snapshot: ${thrown.message}`);

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

    if (!stream.placed) {
      stream.early.push(message);

      return;
    }

    if (!viewed.has(id)) markUnseen(id, true);

    place(stream, message);
    settle(id, holder, stream);
  };

  /** Installs the Terminal's output subscription first, then asks for its screen, so no byte falls between them. */
  const attach = async (id: string, holder: Holder, stream: Stream): Promise<void> => {
    try {
      if (watches.has(id)) await stopWatch(id);

      if (!exited(id)) {
        setFailure(id, "output", null);

        const subscription = await app.selectOutput(id, (message) => receive(id, holder, stream, message));

        if (!stream.open) {
          await subscription.release();

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

      setFailure(id, "output", `terminal.output: ${thrown.message}`);
    }

    if (stream.open) void restore(id, holder, stream);
  };

  const release = async (id: string, holder: Holder): Promise<void> => {
    const stream = holder.stream;

    if (!stream) return;

    if (stream.placed) shownTo.set(id, stream.position);

    stream.open = false;
    stream.queue = [];
    stream.early = [];
    holder.stream = null;

    try {
      await stream.subscription?.release();
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!disposed) setFailure(id, "output", `terminal.output: ${thrown.message}`);
    }
  };

  const exited = (id: string): boolean => {
    const node = rail.nodes.find((candidate) => candidate.terminal_id === id);

    return node === undefined ? rail.terminalExit(id) !== null : rail.exitOf(node) !== null;
  };

  const attempt = async (id: string, call: Promise<unknown>): Promise<void> => {
    try {
      await call;

      setFailure(id, "live", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(id, "live", thrown.message);
    }
  };

  /** U365: a Door's Terminal and a worktree-less Agent's resolve against the Project folder; an Agent's against its Worktree. */
  const open = async (id: string, printed: Printed): Promise<void> => {
    const node = rail.nodes.find((candidate) => candidate.terminal_id === id);
    const path = printed.kind === "path" ? absolutePath(printed.path, node?.kind === "agent" ? node.worktree?.path ?? project.path : project.path) : "";

    try {
      await app.openTarget(printed.kind === "url" ? printed : { kind: "path", path, line: printed.line });
      setFailure(id, "link", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(id, "link", thrown instanceof RpcError && thrown.code === NOT_FOUND ? appCopy.doesNotExist(path) : thrown.message);
    }
  };

  const holderFor = (id: string): Holder => {
    const known = holders.get(id);

    if (known) return known;

    const emulator = createEmulator(id);

    const [atBottom, setAtBottom] = createSignal(true);
    // Tauri may run two `rpc` calls out of order, so at most one write is in flight; what is typed meanwhile goes as one write.
    let typed: number[] = [];
    let writing = false;

    const flush = async (): Promise<void> => {
      writing = true;

      try {
        while (typed.length > 0) {
          const data = toBase64(Uint8Array.from(typed));

          typed = [];
          emulator.inputEncoded?.();
          await attempt(id, app.rpc("terminal.write", { id, data }));
        }
      } finally {
        writing = false;
      }
    };

    const returnToBottom = () => {
      emulator.scrollToBottom();
      setAtBottom(true);
    };

    emulator.onLink((printed) => void open(id, printed));
    emulator.onScroll(() => setAtBottom(emulator.isAtBottom()));
    emulator.onInput((bytes) => {
      if (exited(id) || daemonExit() !== null) return;

      returnToBottom();

      for (const byte of bytes) typed.push(byte);

      if (!writing) void flush();
    });

    const holder: Holder = {
      emulator, ready: !emulator.ready, stopClipboard: null, atBottom, returnToBottom, stream: null, complete: false, shownSize: null,
    };

    holders.set(id, holder);

    void emulator.ready?.then(() => {
      if (disposed) return;

      holder.ready = true;

      if (holder.shownSize && holder.stream?.open) resize(id, holder.emulator.fit());
    });

    return holder;
  };

  const emulatorFor = (id: string): Emulator => holderFor(id).emulator;

  const copy = async (id: string): Promise<void> => {
    const selection = emulatorFor(id).selection();

    if (!selection) return;

    try {
      await writeText(app, selection);
      setFailure(id, "clipboard", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(id, "clipboard", clipboardFailure("copy", thrown));
    }
  };

  const paste = async (id: string, event: Pick<ClipboardEvent, "clipboardData">): Promise<void> => {
    if (exited(id) || daemonExit() !== null) return;

    try {
      const pasted = await readPaste(event);

      if (pasted.kind === "image") {
        const path = await app.savePastedImage(pasted.image);

        pastePaths(id, [path]);
      } else if (pasted.kind === "text" && !exited(id) && daemonExit() === null) emulatorFor(id).paste(pasted.text);

      setFailure(id, "clipboard", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(id, "clipboard", clipboardFailure("paste", thrown));
    }
  };

  const pastePaths = (id: string, paths: string[]): void => {
    if (paths.length === 0 || exited(id) || daemonExit() !== null) return;

    emulatorFor(id).paste(`${paths.map((path) => `'${path.replaceAll("'", "'\\''")}'`).join(" ")} `);
  };

  const show = (id: string, host: HTMLElement, focus?: boolean): Size => {
    const holder = holderFor(id);
    holder.stopClipboard?.();

    const editor = (target: EventTarget | null) => target instanceof Element
      && !!target.closest('input, textarea, [contenteditable="true"]') && !target.closest(".xterm-helper-textarea");

    const onPaste = (event: ClipboardEvent) => {
      if (editor(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void paste(id, event);
    };

    const onKey = (event: KeyboardEvent) => {
      if (editor(event.target) || !event.metaKey) return;

      if (event.key.toLowerCase() === "v" && (event.ctrlKey || event.altKey || event.shiftKey)) {
        event.preventDefault();
        event.stopImmediatePropagation();

        return;
      }

      if (event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void copy(id);
    };

    host.addEventListener("paste", onPaste, true);
    host.addEventListener("keydown", onKey, true);
    holder.stopClipboard = () => {
      host.removeEventListener("paste", onPaste, true);
      host.removeEventListener("keydown", onKey, true);
    };

    const size = holder.emulator.show(host, focus);

    holder.shownSize = size;

    if (!holder.stream) {
      const stream: Stream = {
        open: true, subscription: null, early: [], placed: false, start: null, position: 0,
        queue: [], queued: 0, after: null, restoring: false, lost: false,
      };

      holder.stream = stream;
      void attach(id, holder, stream);
    }

    return size;
  };

  const hide = (id: string): void => {
    const holder = holders.get(id);

    holder?.stopClipboard?.();

    if (holder) void release(id, holder).then(reconcile);
  };

  return {
    emulatorFor,
    show,
    hide,
    resize,
    setFontSize: (size) => {
      for (const holder of holders.values()) holder.emulator.setFontSize(size);
    },
    isAtBottom: (id) => holderFor(id).atBottom(),
    returnToBottom: (id) => holderFor(id).returnToBottom(),
    copy,
    paste,
    pastePaths,
    exited,
    unseen: (id) => unseenIds().has(id),
    viewedInBubble: (id) => bubbled().has(id),
    viewing: (id, on) => {
      setBubbled((current) => {
        if (current.has(id) === on) return current;

        const next = new Set(current);

        if (on) next.add(id);
        else next.delete(id);

        return next;
      });

      if (on) {
        viewed.add(id);
        markUnseen(id, false);
      } else {
        viewed.delete(id);
      }
    },
    failure: (id) => {
      const current = failures();

      if (id !== null) return newestFailure(current.get(id))?.message ?? null;

      let latest: FailureEntry | null = null;

      for (const state of current.values()) {
        const failure = newestFailure(state);

        if (failure && (!latest || failure.order > latest.order)) latest = failure;
      }

      return latest?.message ?? null;
    },
    dismiss: (id) => {
      const state = failures().get(id);
      const shown = newestFailure(state);

      for (const kind of FAILURE_KINDS) if (state?.[kind] === shown) setFailure(id, kind, null);
    },
    dispose: () => {
      disposed = true;

      for (const id of [...watches.keys()]) void stopWatch(id);

      for (const [id, holder] of holders) {
        void release(id, holder);
        holder.stopClipboard?.();
        holder.emulator.dispose();
      }

      holders.clear();
    },
  };
};
