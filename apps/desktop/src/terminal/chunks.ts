/** Output bytes queued for one Terminal, each at the offset of its first byte in the stream. */
export type Backlog = {
  queue: { offset: number; bytes: Uint8Array }[];
  /** The bytes in `queue`. */
  queued: number;
};

const NONE = new Uint8Array();

export const takeFirst = (backlog: Backlog): void => {
  const chunk = backlog.queue.shift();

  if (chunk) backlog.queued -= chunk.bytes.length;
};

/**
 * The next bytes to parse from offset `after`, at most `limit`: the head of the queue, topped up from the
 * chunks that follow it without a gap. Small output events share one parse budget; one event per frame would
 * stretch an ordinary burst over hundreds of frames (X14). Whatever is returned leaves the queue, so the
 * caller's offset advances by the returned length. The head must hold `after`.
 */
export const nextChunk = (backlog: Backlog, after: number, limit: number): Uint8Array => {
  const head = backlog.queue[0];

  if (!head) return NONE;

  const end = head.offset + head.bytes.length;
  let bytes = head.bytes.subarray(after - head.offset, after - head.offset + limit);

  after += bytes.length;

  if (after === end) takeFirst(backlog);

  if (bytes.length < limit && backlog.queue[0]?.offset === after) {
    const combined = new Uint8Array(Math.min(limit, bytes.length + backlog.queued));
    let length = bytes.length;

    combined.set(bytes);

    while (length < combined.length) {
      const next: Backlog["queue"][number] | undefined = backlog.queue[0];

      if (!next || next.offset !== after) break;

      const part = next.bytes.subarray(0, combined.length - length);

      combined.set(part, length);
      length += part.length;
      after += part.length;

      if (part.length === next.bytes.length) takeFirst(backlog);
      else break;
    }

    bytes = combined.subarray(0, length);
  }

  return bytes;
};
