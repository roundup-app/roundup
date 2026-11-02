import { afterEach, expect, it, vi } from "vitest";
import fc from "fast-check";
import { waitFor } from "@solidjs/testing-library";
import type { Message } from "@contracts/message/Message";
import { connectEvents } from "../app/events";
import { createFakeApp } from "../testing/fakeApp";
import { event } from "../testing/nodes";
import { createNoteQueue } from "./noteQueue";

const recipients = ["a", "b"] as const;

const change = fc.record({
  id: fc.integer({ min: 1, max: 12 }),
  recipient: fc.constantFrom(...recipients),
  status: fc.constantFrom("pending", "delivered", "dropped"),
  body: fc.string({ maxLength: 32 }),
});

it("z3802g_note_events_match_reference_fold", async () => {
  await fc.assert(fc.asyncProperty(fc.array(change, { maxLength: 48 }), async (changes) => {
    const app = createFakeApp();
    const events = await connectEvents(app);
    const notes = createNoteQueue(app, events, () => null);
    const history: Message[] = [];

    // Every run crosses recipients, repeats an event and transitions one id through all statuses.
    const sequence = [
      { id: 2, recipient: "b", status: "pending", body: "二" },
      { id: 1, recipient: "a", status: "pending", body: "é" },
      { id: 1, recipient: "a", status: "pending", body: "é" },
      { id: 1, recipient: "a", status: "delivered", body: "é" },
      { id: 1, recipient: "a", status: "dropped", body: "é" },
      ...changes,
    ] as const;

    for (const item of sequence) {
      const message: Message = {
        id: item.id, to: item.recipient, body: item.body,
        from: { kind: "user", id: "user", parent: null },
        kind: "note", replyTo: null, at: history.length, reason: null,
        status: item.status,
      };

      history.push(message);
      const name = message.status === "pending" ? "message.sent" : message.status === "delivered" ? "message.delivered" : "message.dropped";
      app.emit(event({ name, data: message }));

      for (const recipient of recipients) {
        // Scan history instead of sharing the production Map/upsert or waiting helpers.
        const latest = history.filter((row, index) => !history.slice(index + 1).some((later) => later.id === row.id));
        const expected = latest.filter((row) => row.to === recipient && row.status === "pending").sort((a, b) => a.id - b.id);
        expect(notes.rows(recipient)).toEqual(expected);
      }

      expect(app.calls).toEqual([]);
    }
  }), { numRuns: 128, seed: 3802 });
});


const message = (id: number, to = "a", status: Message["status"] = "pending"): Message => ({
  id, to, status, body: `body-${id} 雪`, from: { kind: "user", id: "user", parent: null },
  kind: "note", replyTo: null, at: id, reason: null,
});

const emit = (app: ReturnType<typeof createFakeApp>, row: Message) => app.emit(event({
  name: row.status === "pending" ? "message.sent" : row.status === "delivered" ? "message.delivered" : "message.dropped", data: row,
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Track production collection ownership, including replacement Maps; no GC observation.
const collections = () => {
  const NativeMap = Map;
  const NativeSet = Set;
  const owned = new NativeSet<Map<unknown, unknown> | Set<unknown>>();

  class ObservedMap<K, V> extends NativeMap<K, V> {
    constructor(values?: Iterable<readonly [K, V]> | null) {
      super(values);

      if (values instanceof NativeMap) owned.delete(values);
      owned.add(this);
    }
  }

  class ObservedSet<T> extends NativeSet<T> {
    constructor(values?: Iterable<T> | null) {
      super(values);

      if (values instanceof NativeSet) owned.delete(values);
      owned.add(this);
    }
  }

  vi.stubGlobal("Map", ObservedMap);
  vi.stubGlobal("Set", ObservedSet);

  return () => [...owned].flatMap(map => [...map.values()]);
};

it("u5643b_settled_messages_release_payloads", async () => {
  const app = createFakeApp();
  const events = await connectEvents(app);
  const retained = collections();
  const notes = createNoteQueue(app, events, () => null);

  for (let id = 1; id <= 1000; id++) {
    emit(app, message(id));
    emit(app, message(id, "a", id % 2 === 0 ? "delivered" : "dropped"));
  }

  const pending = [message(1002, "a"), message(1001, "b")];

  for (const row of pending) emit(app, row);
  app.handlers["message.list"] = () => [message(2001, "c", "delivered"), message(2002, "c", "dropped")];
  notes.load("c");
  await Promise.resolve();
  await Promise.resolve();

  const contents = JSON.stringify(retained(), (_key, value) =>
    value instanceof Map || value instanceof Set ? [...value.values()] : value);

  const count = [...contents.matchAll(/"body":/g)].length;
  vi.unstubAllGlobals();
  expect(count).toBe(2);
  expect(notes.rows("a")).toEqual([pending[0]]);
  expect(notes.rows("b")).toEqual([pending[1]]);
  expect(notes.rows("c")).toEqual([]);
});

it("u5643b_recipient_reads_touch_only_its_pending_rows", async () => {
  const app = createFakeApp();
  const events = await connectEvents(app);
  const notes = createNoteQueue(app, events, () => null);

  for (let id = 1; id <= 1000; id++) emit(app, message(id, "past", id % 2 === 0 ? "delivered" : "dropped"));
  const other = message(1001, "b");
  emit(app, other);
  emit(app, message(1003));
  emit(app, message(1002));
  let inspected = 0;
  // Production retains this Message; read instrumentation starts after event folding.
  Object.defineProperty(other, "to", { get: () => {
    inspected++;

    return "b";
  }, configurable: true });
  const filtering = vi.spyOn(Array.prototype, "filter");
  const sorting = vi.spyOn(Array.prototype, "sort");
  const reads = Array.from({ length: 20 }, () => notes.rows("a"));
  const counts = { inspected, filtering: filtering.mock.calls.length, sorting: sorting.mock.calls.length };
  vi.restoreAllMocks();
  expect(counts).toEqual({ inspected: 0, filtering: 0, sorting: 0 });

  for (const rows of reads) expect(rows).toEqual([message(1002), message(1003)]);
  expect(app.calls).toEqual([]);
});

it.each(["pending", "delivered", "dropped"] as const)("u5643b_events_outrank_lists_%s", async (status) => {
  const app = createFakeApp();
  const events = await connectEvents(app);
  const notes = createNoteQueue(app, events, () => null);
  const replies = new Map<string, (rows: Message[]) => void>();
  app.handlers["message.list"] = ({ to }) => new Promise(resolve => { replies.set(to!, resolve); });
  notes.load("a");
  notes.load("b");
  emit(app, message(2));
  expect(notes.rows("a")).toEqual([message(2)]);
  const moved = { ...message(2, "b", status), body: "newer event" };

  for (let repeat = 0; repeat < 2; repeat++) {
    emit(app, moved);
    expect(notes.rows("a")).toEqual([]);
    expect(notes.rows("b")).toEqual(status === "pending" ? [moved] : []);
  }

  notes.load("c"); // A load started after the event must also respect observed ids.

  for (const [index, to] of ["a", "b", "c"].entries()) {
    const first = 5 + index * 10;
    replies.get(to)!([message(2, to), message(first + 5, to), message(first, to)]);
    await waitFor(() => expect(notes.rows(to)).toEqual([...(to === "b" && status === "pending" ? [moved] : []), message(first, to), message(first + 5, to)]));
  }

  expect(app.calls.map(call => call.method)).toEqual(["message.list", "message.list", "message.list"]);
});
