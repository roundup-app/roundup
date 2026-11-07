import type { OutputMessage, OutputSubscription } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import { fromBase64 } from "./base64";
import { nextChunk, takeFirst } from "./chunks";
import type { Backlog } from "./chunks";
import { copy as appCopy } from "./copy";
import type { Emulator } from "./emulator";
import type { Failures } from "./failures";
import { restoreScrollback } from "./scrollback";
import type { Watches } from "./watch";

/** Bytes buffered for one Terminal while its screen is fetched; past this the oldest go and the screen is fetched again. */
const MAX_BUFFERED_BYTES = 1_048_576;

/** A parse cannot be interrupted, so a chunk is sized to take about this long: a typed echo waits behind at most one. */
const TARGET_PARSE_MS = 2;

const MIN_CHUNK_BYTES = 512;

const MAX_CHUNK_BYTES = 8192;

/** Where the subscription stands; it changes only at subscribe and release, never per chunk. */
type Phase =
  | { kind: "subscribing"; /** Messages that arrived before the subscription's first offset was known. */ early: OutputMessage[] }
  | { kind: "placed"; subscription: OutputSubscription; start: number }
  | { kind: "released" };

/** One output subscription of a displayed Terminal, and the stream state that belongs to it alone. */
export type Stream = Backlog & {
  phase: Phase;
  /** The offset the next byte of the stream gets. */
  position: number;
  /** The offset the emulator has been written up to; null until the first screen. */
  after: number | null;
  restoring: boolean;
  parsing: boolean;
  /** Bytes the next chunk may hold, from how fast the last one parsed. */
  chunk: number;
  lost: boolean;
};

/** What the pump reads and writes of a displayed Terminal. */
export type PumpHolder = {
  retain: () => void;
  incarnation: string | undefined;
  emulator: Emulator;
  stream: Stream | null;
  complete: boolean;
};

export type PumpDeps<H extends PumpHolder> = {
  connected: ConnectedProject;
  failures: Failures;
  watches: Watches;
  /** Terminals the user is viewing; their output is not unseen. */
  viewed: ReadonlySet<string>;
  shownTo: ReadonlyMap<string, number>;
  exited: (id: string) => boolean;
  /** The Terminal's agent has had its alerts seen. */
  acknowledge: (agentId: string) => void;
  reflow: (id: string, holder: H) => void;
};

export const createStream = (): Stream => ({
  phase: { kind: "subscribing", early: [] }, position: 0,
  queue: [], queued: 0, after: null, restoring: false, parsing: false, chunk: MAX_CHUNK_BYTES, lost: false,
});

const isOpen = (stream: Stream): boolean => stream.phase.kind !== "released";

/** Bytes get the offsets the stream's contiguous positions give them; a gap drops what was queued and asks for a fresh snapshot. */
export const place = (stream: Stream, message: OutputMessage): void => {
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

export const createPump = <H extends PumpHolder>({ connected, failures, watches, viewed, shownTo, exited, acknowledge, reflow }: PumpDeps<H>) => {
  const { app, rail } = connected;

  const drain = (id: string, holder: H, stream: Stream): void => {
    if (stream.restoring || stream.parsing || stream.after === null || !isOpen(stream)) return;

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

      const bytes = nextChunk(stream, stream.after, stream.chunk);

      stream.after += bytes.length;

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

            if (isOpen(stream) && holder.stream === stream) settle(id, holder, stream);
          });
          else {
            stream.parsing = false;

            // A gap delivered during the parse found `settle` returning early; nothing else will start its restore.
            if (stream.lost && isOpen(stream) && holder.stream === stream) settle(id, holder, stream);
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

  /** Fetches the screen into the emulator; false when the subscription closed meanwhile. */
  const load = async (id: string, holder: H, stream: Stream): Promise<boolean> => {
    const retained = await restoreScrollback(
      connected, id, holder.incarnation, holder.emulator, holder.complete, shownTo.get(id),
      () => isOpen(stream) && stream.after === null && !stream.lost,
      cause => console.warn(appCopy.terminalOutputNotKept(cause)),
    );

    if (!isOpen(stream)) return false;

    if (retained !== null) {
      stream.after = retained;
      requestAnimationFrame(() => reflow(id, holder));

      return true;
    }

    const snapshot = await app.rpc("terminal.snapshot", { id });

    if (!isOpen(stream)) return false;

    if (holder.complete) holder.emulator.reset();

    holder.emulator.setSize({ cols: snapshot.cols, rows: snapshot.rows });
    holder.emulator.write(fromBase64(snapshot.data), () => requestAnimationFrame(() => reflow(id, holder)));

    stream.after = snapshot.after;

    return true;
  };

  const acknowledgeSelected = (id: string): void => {
    const agent = rail.nodes.find(node => node.terminal_id === id);

    if (agent && rail.shouldAcknowledgeAlerts() && rail.selected() === agent.id) acknowledge(agent.id);
  };

  const restore = async (id: string, holder: H, stream: Stream): Promise<void> => {
    if (stream.restoring || !isOpen(stream)) return;

    stream.restoring = true;

    try {
      if (!(await load(id, holder, stream))) return;

      holder.complete = true;
      holder.retain();
      failures.set(id, "snapshot", null);
      acknowledgeSelected(id);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!isOpen(stream)) return;

      failures.set(id, "snapshot", appCopy.terminalRestoreFailed(thrown.message), () => {
        if (isOpen(stream) && !stream.restoring) void restore(id, holder, stream);
      });

      if (!holder.complete) stream.after = stream.queue[0]?.offset ?? (stream.phase.kind === "placed" ? stream.phase.start : 0);

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

  const settle = (id: string, holder: H, stream: Stream): void => {
    if (stream.parsing) return;

    if (stream.lost && !stream.restoring) {
      stream.lost = false;
      void restore(id, holder, stream);
    } else {
      drain(id, holder, stream);
    }
  };

  const receive = (id: string, holder: H, stream: Stream, message: OutputMessage): void => {
    // A callback that outlives its subscription (released, replaced or disposed) reaches nothing.
    if (!isOpen(stream) || holder.stream !== stream) return;

    if (!("gap" in message)) holder.emulator.outputArrived?.(message);

    if (stream.phase.kind === "subscribing") {
      stream.phase.early.push(message);

      return;
    }

    if (!viewed.has(id)) watches.markUnseen(id, true);

    place(stream, message);
    settle(id, holder, stream);
  };

  /** Installs the Terminal's output subscription first, then asks for its screen, so no byte falls between them. */
  const attach = async (id: string, holder: H, stream: Stream): Promise<void> => {
    try {
      if (watches.watching(id)) await watches.stop(id);

      if (!exited(id)) {
        failures.set(id, "output", null);

        const subscription = await watches.subscribe(id, (message) => receive(id, holder, stream, message), () => isOpen(stream));

        if (!isOpen(stream) || subscription === null) {
          await subscription?.release();

          return;
        }

        const early = stream.phase.kind === "subscribing" ? stream.phase.early : [];

        stream.phase = { kind: "placed", subscription, start: subscription.offset };
        stream.position = subscription.offset;

        for (const message of early) place(stream, message);
      }
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!isOpen(stream)) return;

      failures.set(id, "output", appCopy.terminalOutputStopped(thrown.message), () => {
        if (isOpen(stream)) void attach(id, holder, stream);
      });
    }

    if (isOpen(stream)) void restore(id, holder, stream);
  };

  return { drain, restore, settle, receive, attach };
};
