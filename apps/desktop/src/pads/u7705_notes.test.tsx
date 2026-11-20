import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";
import type { FakeApp } from "../testing/fakeApp";
import type { Touch } from "@contracts/Touch";
import type { Message } from "@contracts/message/Message";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const accepted: Message = { id: 1, from: USER, to: AGENT.id, kind: "note", body: "", replyTo: null, status: "delivered", reason: null, at: 0 };

const bodyOf = (call: FakeApp["calls"][number] | undefined) => String(Object.fromEntries(Object.entries(call?.params ?? {})).body);

const notes = () => document.querySelectorAll(".pad-note-list li").length;

const touch = (actor = AGENT, verb: Touch["verb"] = "wrote", at = 5): Touch => ({ actor, verb, item: "pad:plan", at });

/** An Agent's Pad "plan" on the Rail, open in its Drawer, with `hello world` as text. */
const open = async (history = [touch()], text = "hello world") => {
  const shelf = await openShelf([padOf("plan", AGENT, text), padOf("other", AGENT)], true);
  shelf.state.history = history;
  shelf.app.handlers["message.send"] = () => accepted;
  const field = await openPad("plan");

  return { ...shelf, field };
};

const select = (field: HTMLTextAreaElement, start: number, end: number) => field.setSelectionRange(start, end, "forward");

const sends = (app: FakeApp) => app.calls.filter(call => call.method === "message.send");

const addNote = async (field: HTMLTextAreaElement, text: string, start = 1, end = 6) => {
  select(field, start, end);
  fireEvent.click(await screen.findByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
};

it("u7705a_selecting_text_offers_a_note_and_writes_nothing", async () => {
  const { app, field } = await open();

  expect(document.querySelectorAll(".pad-notes > button")).toHaveLength(0);
  select(field, 1, 6);
  fireEvent.click(await screen.findByRole("button", { name: "Add note" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: "  " } });
  expect(save.hasAttribute("disabled")).toBe(true);

  fireEvent.keyDown(screen.getByLabelText("Note", { selector: "textarea" }), { key: "Escape" });
  expect(document.querySelector(".pad-note-form")).toBeNull();
  expect(document.querySelector(".pad-note-list")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.click(within(screen.getByRole("form", { name: "Note on selection" })).getByRole("button", { name: "Close" }));
  expect(notes()).toBe(0);

  await addNote(field, "why?");
  await screen.findByText("why?");
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
  expect(field.value).toBe("hello world");
});

it("u7705b_send_calls_message_send_once_to_the_last_writer_with_pad_revision_quote_and_note", async () => {
  // A later read by the user never makes them the writer.
  const { app, field } = await open([touch(AGENT, "wrote", 5), touch(USER, "read", 9)]);
  await addNote(field, "  exact\ncomment  ");
  const send = await screen.findByRole("button", { name: "Send note: auth-refactor" });
  fireEvent.click(send);
  fireEvent.click(send);

  await waitFor(() => expect(sends(app)).toHaveLength(1));
  expect(sends(app)[0]?.params).toMatchObject({ to: AGENT.id, kind: "note", replyTo: null });
  expect(bodyOf(sends(app)[0])).toContain("The Pad is plan.\nThe version is 1.\nThe quote is:\nhello\n\nThe comment is:\n  exact\ncomment  ");
  await waitFor(() => expect(notes()).toBe(0));
});

it("u7705b_nothing_sends_without_the_click", async () => {
  const { app, field } = await open();
  await addNote(field, "kept");
  await screen.findByRole("button", { name: "Send note: auth-refactor" });

  expect(sends(app)).toHaveLength(0);
});

it("u7705b_a_user_or_departed_last_writer_asks_for_a_receiver", async () => {
  const { app, field } = await open([touch(USER)]);
  await addNote(field, "who gets this");
  fireEvent.click(await screen.findByRole("button", { name: "Send note: …" }));
  expect(sends(app)).toHaveLength(0);

  fireEvent.click(within(screen.getByRole("group", { name: "Send note to" })).getByRole("button", { name: "auth-refactor" }));
  await waitFor(() => expect(sends(app)).toHaveLength(1));
  expect(sends(app)[0]?.params).toMatchObject({ to: AGENT.id });
});

it("u7705c_an_unsent_note_survives_closing_the_drawer", async () => {
  const { connected, field } = await open();
  await addNote(field, "still here");
  await screen.findByText("still here");

  connected.drawer.close("key");
  await waitFor(() => expect(notes()).toBe(0));
  await openPad("other");
  expect(notes()).toBe(0);

  connected.drawer.close("key");
  await openPad("plan");
  await screen.findByText("still here");
});

it("u7705c_an_agent_rewrite_keeps_the_notes_revision", async () => {
  const { app, state, field } = await open();
  await addNote(field, "before rewrite");
  await screen.findByText("before rewrite");

  state.pads = [{ ...padOf("plan", AGENT, "rewritten text"), revision: 2 }];
  app.emit({ actor: AGENT, name: "pad.changed", data: { name: "plan" } });
  await waitFor(() => expect(field.value).toBe("rewritten text"));
  fireEvent.click(await screen.findByRole("button", { name: "Send note: auth-refactor" }));

  await waitFor(() => expect(sends(app)).toHaveLength(1));
  const body = bodyOf(sends(app)[0]);
  expect(body).toContain("The version is 1.\nThe quote is:");
  expect(body).not.toContain("The version is 2");
});

it("u7705c_send_outcomes_keep_or_clear_the_note", async () => {
  const { app, field } = await open();
  await addNote(field, "flaky");
  let attempts = 0;
  app.handlers["message.send"] = () => {
    if (++attempts === 1) throw new Error("daemon says no");

    return accepted;
  };

  fireEvent.click(await screen.findByRole("button", { name: "Send note: auth-refactor" }));
  await screen.findByText("daemon says no");
  expect(notes()).toBe(1);
  expect(attempts).toBe(1);

  fireEvent.click(await screen.findByRole("button", { name: "Retry send: auth-refactor" }));
  await waitFor(() => expect(notes()).toBe(0));
  expect(attempts).toBe(2);
});

it("u7705d_a_2000_character_selection_is_quoted_whole", async () => {
  const long = "abcdefghij".repeat(200);
  const { app, field } = await open([touch()], long);
  await addNote(field, "long one", 1, 2001);
  fireEvent.click(await screen.findByRole("button", { name: "Send note: auth-refactor" }));

  await waitFor(() => expect(sends(app)).toHaveLength(1));
  expect(bodyOf(sends(app)[0])).toContain(`The quote is:\n${long}\n\nThe comment is:`);
});
