import { notesFor } from "./notes";
import { copy } from "./copy";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { message } from "../testing/centreFixture";
import { openDiff, saveNote } from "./noteHarness";
import { afterEach, expect, it, vi } from "vitest";
import { storageIdle } from "../state/storage";
import type { Message } from "@contracts/message/Message";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await storageIdle(); localStorage.clear(); });

const meta = () => document.querySelector(".note-view .note-meta")?.textContent;

/** A send whose reply stays open until `release`, so events can overtake it. */
const sendPending = async () => {
  const mounted = await openDiff();
  let release: (value: Message) => void = () => {};

  await saveNote("queued");
  mounted.app.handlers["message.send"] = () => new Promise<Message>(resolve => { release = resolve; });
  fireEvent.click(within(screen.getByLabelText(copy.notesRegion, { selector: "section" })).getByRole("button", { name: /Send notes:/ }));
  await waitFor(() => expect(mounted.app.calls.some(call => call.method === "message.send")).toBe(true));

  return { ...mounted, release: (value: Message) => release(value) };
};

it("u7956b_a_delivery_before_the_send_reply_reads_sent", async () => {
  const { app, release } = await sendPending();

  app.emit({ name: "message.delivered", data: message(7, { to: "a", status: "delivered" }), actor: { kind: "user", id: "you", parent: null } });
  release(message(7, { to: "a", status: "pending" }));
  await waitFor(() => expect(notesFor(app, "/p").all("a")[0]?.landed).toBeTypeOf("number"));
  expect(meta()).not.toContain(copy.waiting);
});

it("u7956b_a_merged_drop_before_the_send_reply_reads_waiting_then_sent", async () => {
  const { app, release } = await sendPending();

  app.emit({ name: "message.dropped", data: message(7, { to: "a", status: "dropped", reason: "merged" }), actor: { kind: "user", id: "you", parent: null } });
  release(message(7, { to: "a", status: "pending" }));
  await waitFor(() => expect(notesFor(app, "/p").all("a")[0]?.message).toBe(7));
  expect(meta()).toContain(copy.waiting);
  app.emit({ name: "message.delivered", data: message(8, { to: "a", status: "delivered" }), actor: { kind: "user", id: "you", parent: null } });
  await waitFor(() => expect(notesFor(app, "/p").all("a")[0]?.landed).toBeTypeOf("number"));
});

it("u7956b_an_event_for_no_note_changes_nothing", async () => {
  const { app, release } = await sendPending();

  app.emit({ name: "message.delivered", data: message(9, { to: "a", status: "delivered" }), actor: { kind: "user", id: "you", parent: null } });
  release(message(7, { to: "a", status: "pending" }));
  await waitFor(() => expect(notesFor(app, "/p").all("a")[0]?.message).toBe(7));
  expect(notesFor(app, "/p").all("a")[0]?.landed).toBeUndefined();
  expect(meta()).toContain(copy.waiting);
});
