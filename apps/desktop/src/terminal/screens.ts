import { copy as appCopy } from "../copy";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { PASTED_IMAGE_TYPES, RpcError } from "../app/seam";
import type { OutputMessage, OutputSubscription, PastedImage } from "../app/seam";
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
  copy(id: string, clipboard: Pick<Clipboard, "writeText">): Promise<void>;
  paste(id: string, clipboard: Pick<Clipboard, "readText"> & Partial<Pick<Clipboard, "read">>): Promise<void>;
  /** Whether the Terminal has exited. */
  exited(id: string): boolean;
  /** Pastes dropped paths as one shell line fragment (U162); an exited Terminal or Daemon, or no path, takes nothing. */
  pastePaths(id: string, paths: string[]): void;
  /** The selected Terminal's last failed call or `terminal.output`, until a later call for that Terminal succeeds. */
  failure(id: string | null): string | null;
  dispose(): void;
};

/** Bytes held for one Terminal while its screen is fetched; past this the oldest go and the screen is fetched again. */
const MAX_HELD_BYTES = 1_048_576;

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

const takeFirst = (stream: Stream): void => {
  const chunk = stream.queue.shift();

  if (chunk) stream.queued -= chunk.bytes.length;
};

type Holder = {
  emulator: Emulator;
  atBottom: Accessor<boolean>;
  returnToBottom: () => void;
  stream: Stream | null;
  complete: boolean;
  shownSize: Size | null;
};

type FailureEntry = { message: string; order: number };

/** `output` is the subscription's own failure: a later successful call does not clear it, only a new subscription does. */
type TerminalFailures = { snapshot: FailureEntry | null; live: FailureEntry | null; output: FailureEntry | null; clipboard: FailureEntry | null; link: FailureEntry | null };

const newestFailure = (state: TerminalFailures | undefined): FailureEntry | null => {
  if (!state) return null;

  return [state.snapshot, state.live, state.output, state.clipboard, state.link].reduce<FailureEntry | null>(
    (latest, entry) => entry && (!latest || entry.order > latest.order) ? entry : latest,
    null,
  );
};

const NOT_FOUND = -32001;

const IMAGE_ON_CLIPBOARD = appCopy.pasteFailedTheClipboardHoldsAnImageWhich;

/** U349: a refusal is named in roundup's terms with the next step; any other failure keeps its message after the verb. */
const clipboardFailure = (verb: "copy" | "paste", thrown: Error): string => {
  if (thrown.name !== "NotAllowedError") return appCopy.failed(verb === "paste" ? appCopy.paste : appCopy.copy, thrown.message);

  return verb === "paste"
    ? appCopy.pasteFailedTheSystemClipboardRefusedItPress
    : appCopy.copyFailedTheSystemClipboardRefusedItPress;
};

type ClipboardImage = { item: ClipboardItem; type: PastedImage["type"] } | "unsupported" | null;

/** The first item the seam can save (U418), "unsupported" for images it cannot, null for none. A refused or missing `read()` is not a failure: an empty text paste stays silent (U101). */
const imageOnClipboard = async (clipboard: Partial<Pick<Clipboard, "read">>): Promise<ClipboardImage> => {
  try {
    const items = (await clipboard.read?.()) ?? [];

    for (const item of items) {
      const type = PASTED_IMAGE_TYPES.find((accepted) => item.types.includes(accepted));

      if (type) return { item, type };
    }

    return items.some((item) => item.types.some((type) => type.startsWith("image/"))) ? "unsupported" : null;
  } catch {
    return null;
  }
};

/** `watching(id)`: U375, the user reads this Terminal without typing, so nothing typed or pasted reaches it. */
export const createScreens = (connected: ConnectedProject, createEmulator: EmulatorFactory, watching: (id: string) => boolean = () => false): Screens => {
  const { app, rail, daemonExit, project } = connected;
  const holders = new Map<string, Holder>();
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

    if (changedOnly && holder?.shownSize?.cols === size.cols && holder.shownSize.rows === size.rows) return;

    if (holder?.shownSize) holder.shownSize = size;

    if (!exited(id) && daemonExit() === null) void attempt(id, app.rpc("terminal.resize", { id, ...size }));
  };

  const reflow = (id: string, holder: Holder): void => {
    if (disposed || !holder.shownSize) return;

    const fitted = holder.emulator.fit();

    if (fitted.cols !== holder.shownSize.cols || fitted.rows !== holder.shownSize.rows) resize(id, fitted);
  };

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

    while (stream.queued > MAX_HELD_BYTES) {
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

    place(stream, message);
    settle(id, holder, stream);
  };

  /** Installs the Terminal's output subscription first, then asks for its screen, so no byte falls between them. */
  const attach = async (id: string, holder: Holder, stream: Stream): Promise<void> => {
    try {
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
      if (exited(id) || daemonExit() !== null || watching(id)) return;

      returnToBottom();

      for (const byte of bytes) typed.push(byte);

      if (!writing) void flush();
    });

    const holder: Holder = {
      emulator, atBottom, returnToBottom, stream: null, complete: false, shownSize: null,
    };

    holders.set(id, holder);

    return holder;
  };

  const emulatorFor = (id: string): Emulator => holderFor(id).emulator;

  const copy = async (id: string, clipboard: Pick<Clipboard, "writeText">): Promise<void> => {
    const selection = emulatorFor(id).selection();

    if (!selection) return;

    try {
      await clipboard.writeText(selection);
      setFailure(id, "clipboard", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      setFailure(id, "clipboard", clipboardFailure("copy", thrown));
    }
  };

  const paste = async (id: string, clipboard: Pick<Clipboard, "readText"> & Partial<Pick<Clipboard, "read">>): Promise<void> => {
    if (exited(id) || daemonExit() !== null) return;

    try {
      const text = await clipboard.readText();

      const image = text ? null : await imageOnClipboard(clipboard);

      if (image === "unsupported") {
        setFailure(id, "clipboard", IMAGE_ON_CLIPBOARD);

        return;
      }

      if (image) {
        const bytes = new Uint8Array(await (await image.item.getType(image.type)).arrayBuffer());
        const path = await app.savePastedImage({ type: image.type, bytes });

        pastePaths(id, [path]);
      } else if (text && !exited(id) && daemonExit() === null) emulatorFor(id).paste(text);

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

    if (holder) void release(id, holder);
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
    dispose: () => {
      disposed = true;

      for (const [id, holder] of holders) {
        void release(id, holder);
        holder.emulator.dispose();
      }

      holders.clear();
    },
  };
};
