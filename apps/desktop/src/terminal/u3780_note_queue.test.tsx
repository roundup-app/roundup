import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { node, info } from "../testing/nodes";
import { press } from "../switcher/switcherFixture";
import { mountNotes, note, noteField, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const AGENTS = [node("a", { name: "Ann" }), node("b", { name: "Bo" })];

const TERMINALS = [info("t-a"), info("t-b")];

const type = (field: HTMLTextAreaElement, text: string) => fireEvent.input(field, { target: { value: text } });

it("u3780_the_field_takes_notes_and_never_types_into_the_terminal", async () => {
  const { app, connected, emulators } = await mountNotes(AGENTS, TERMINALS);

  connected.rail.select("a");

  const field = await noteField("Ann");

  type(field, "mind the tests");

  expect(app.calls.filter((call) => call.method === "terminal.write" || call.method === "takeover.begin")).toEqual([]);
  expect(field.value).toBe("mind the tests");

  emulators.get("t-a")?.type(Uint8Array.from([108]));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "terminal.write")).toHaveLength(1));
  expect(app.calls.filter((call) => call.method === "message.send")).toEqual([]);
});

it("u3780_the_queue_is_the_agents_waiting_messages_in_order", async () => {
  const { app, connected, container } = await mountNotes(AGENTS, TERMINALS, [
    note(3, "third\nwith more", { status: "held", reason: "takeover" }),
    note(1, "first"),
    note(2, "taken", { status: "delivered" }),
    note(4, "to Bo", { to: "b" }),
  ]);

  connected.rail.select("a");
  await waitFor(() => expect(rowsOf()).toEqual(["first", "third…"]));
  expect(container.querySelector('[data-note="3"]')?.getAttribute("aria-description")).toBe("third\nwith more");
  expect(screen.getByText("2 waiting")).toBeTruthy();

  app.emit(sent(note(5, "fifth")));
  await waitFor(() => expect(rowsOf()).toHaveLength(3));
  app.emit(sent(note(1, "first", { status: "dropped", reason: "removed" })));
  await waitFor(() => expect(rowsOf()).toEqual(["third…", "fifth"]));
});

it("u3780_an_empty_queue_draws_nothing_above_the_field", async () => {
  const { connected, container } = await mountNotes(AGENTS, TERMINALS);

  connected.rail.select("a");
  await screen.findByRole("textbox", { name: "Note to Ann" });

  expect(container.querySelector(".note-queue-head, .note-queue-row")).toBeNull();
});

it("u3780_a_refused_note_stays_in_the_field_with_its_cause", async () => {
  const { app, connected } = await mountNotes(AGENTS, TERMINALS);

  connected.rail.select("a");

  const field = await noteField("Ann");

  app.handlers["message.send"] = () => { throw new RpcError(-32602, "body is over 8192 bytes"); };

  field.focus();
  type(field, "x".repeat(9000));
  press("Enter", {}, field);

  expect(await screen.findByText("body is over 8192 bytes")).toBeTruthy();
  expect(field.value).toHaveLength(9000);

  type(field, "  \n ");
  app.calls.length = 0;
  press("Enter", {}, field);
  expect(app.calls.filter((call) => call.method === "message.send")).toEqual([]);
});

it("u3780_two_agents_never_share_a_queue_or_a_draft", async () => {
  const { connected } = await mountNotes(AGENTS, TERMINALS, [note(1, "for Ann"), note(2, "for Bo", { to: "b" })]);

  connected.rail.select("a");
  type(await noteField("Ann"), "draft of Ann");
  await waitFor(() => expect(rowsOf()).toEqual(["for Ann"]));

  connected.rail.select("b");
  await waitFor(() => expect(rowsOf()).toEqual(["for Bo"]));
  const bo = await noteField("Bo");

  expect(bo.value).toBe("");
  type(bo, "draft of Bo");

  connected.rail.select("a");
  await waitFor(async () => expect((await noteField("Ann")).value).toBe("draft of Ann"));
  expect(within(document.body).queryByText("for Bo")).toBeNull();
  vi.restoreAllMocks();
});
