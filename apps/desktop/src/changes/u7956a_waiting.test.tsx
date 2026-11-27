import { notesFor } from "./notes";
import { copy } from "./copy";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { message } from "../testing/centreFixture";
import { openDiff, saveNote } from "./noteHarness";
import { afterEach, expect, it, vi } from "vitest";
import { storageIdle } from "../state/storage";
import type { Message } from "@contracts/message/Message";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await storageIdle(); localStorage.clear(); });

const state = () => document.querySelector(".note-view")?.getAttribute("data-state");

const meta = () => document.querySelector(".note-view .note-meta")?.textContent;

/** A note sent while the Agent works: the Daemon answers the send with a pending Message. */
const sendWaiting = async () => {
  const mounted = await openDiff();

  await saveNote("queued");
  mounted.app.handlers["message.send"] = params => message(7, { to: params.to, body: params.body, status: "pending" });
  fireEvent.click(within(screen.getByLabelText(copy.notesRegion, { selector: "section" })).getByRole("button", { name: /Send notes:/ }));
  await waitFor(() => expect(notesFor(mounted.app, "/p").all("a")[0]?.sent).toBeTypeOf("number"));

  return mounted;
};

const emit = (app: Awaited<ReturnType<typeof openDiff>>["app"], name: "message.delivered" | "message.dropped", data: Message) => app.emit(name === "message.delivered" ? { name, data, actor: data.from } : { name: "message.dropped", data, actor: data.from });

it("u7956a_a_note_with_a_pending_message_reads_waiting", async () => {
  await sendWaiting();
  await waitFor(() => expect(meta()).toBe(`${copy.newLine(1)} · ${copy.waiting}`));
});

it("u7956a_a_delivered_message_turns_waiting_into_sent", async () => {
  const { app } = await sendWaiting();

  await waitFor(() => expect(meta()).toContain(copy.waiting));
  emit(app, "message.delivered", message(7, { to: "a", status: "delivered" }));
  await waitFor(() => expect(state()).toBe("sent"));
});

it("u7956a_a_merged_note_reads_sent_when_the_merging_delivery_lands", async () => {
  const { app } = await sendWaiting();

  emit(app, "message.dropped", message(7, { to: "a", status: "dropped", reason: "merged" }));
  await storageIdle();
  expect(meta()).toContain(copy.waiting);
  emit(app, "message.delivered", message(8, { to: "a", status: "delivered" }));
  await waitFor(() => expect(state()).toBe("sent"));
});

it("u7956a_a_waiting_note_survives_a_restart_and_follows_its_message", async () => {
  const first = await sendWaiting();

  await storageIdle();
  first.view.unmount();
  const next = await openDiff("/p", first.connected.drafts);

  await waitFor(() => expect(meta()).toContain(copy.waiting));
  expect(notesFor(next.app, "/p").list("a")).toEqual([]);
  emit(next.app, "message.delivered", message(7, { to: "a", status: "delivered" }));
  await waitFor(() => expect(state()).toBe("sent"));
});
