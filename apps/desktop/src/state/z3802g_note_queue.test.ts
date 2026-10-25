import { expect, it } from "vitest";
import fc from "fast-check";
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
