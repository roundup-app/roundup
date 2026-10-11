import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { withScopeRow } from "../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Message } from "@contracts/message/Message";
import { USER } from "../testing/nodes";
import { AGENT, openPad, openShelf, padOf, RpcError } from "./padsFixture";

afterEach(cleanup);

const SCRIBE: Actor = { kind: "agent", id: "scribe-1", parent: null };

const note = (id: number, over: Partial<Message> = {}): Message => ({
  id,
  from: USER,
  to: SCRIBE.id,
  kind: "note",
  body: "shorten",
  replyTo: null,
  status: "delivered",
  reason: null,
  passedFrom: null,
  at: 0,
  ...over,
});

const asks = (calls: Awaited<ReturnType<typeof openShelf>>["app"]["calls"]) => calls.filter((call) => call.method === "pad.ask");

const answering = (app: Awaited<ReturnType<typeof openShelf>>["app"]) => {
  app.handlers["pad.ask"] = ({ text }) => ({ agent: SCRIBE.id, message: note(1, { body: text }) });
};

const input = () => screen.findByLabelText<HTMLInputElement>("Ask or edit this pad");

const type = (field: HTMLInputElement, value: string) => fireEvent.input(field, { target: { value } });

describe("u190 one input asks the Pad's Scribe", () => {
  it.each([
    ["user", USER],
    ["agent", AGENT],
  ])("u190_input_label_and_send_on_a_pad_a_%s_owns_and_no_append", async (_who, owner) => {
    await openShelf([padOf("notes", owner, "x")]);
    await openPad("notes");

    const field = await input();

    expect([field.labels?.[0]?.textContent, screen.getByRole("button", { name: "send" }).textContent, screen.queryByLabelText("append"), document.querySelectorAll(".pad-ask input").length]).toEqual([
      "Ask or edit this pad",
      "send",
      null,
      1,
    ]);
  });

  it("u190_enter_and_send_each_call_pad_ask_once_and_clear_the_field", async () => {
    const { app } = await openShelf([padOf("notes", AGENT, "x")]);
    answering(app);
    await openPad("notes");
    const field = await input();

    type(field, "shorten");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe(""));
    type(field, "again");
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(field.value).toBe(""));

    expect(asks(app.calls).map((call) => call.params)).toEqual([
      { name: "notes", text: "shorten" },
      { name: "notes", text: "again" },
    ]);
  });

  it("u190_empty_text_calls_nothing", async () => {
    const { app } = await openShelf([padOf("notes", USER, "x")]);
    await openPad("notes");
    const field = await input();

    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    expect(asks(app.calls)).toEqual([]);
  });

  it("u190_two_quick_enters_ask_once", async () => {
    const { app } = await openShelf([padOf("notes", AGENT, "x")]);
    answering(app);
    await openPad("notes");
    const field = await input();

    type(field, "shorten");
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe(""));

    expect(asks(app.calls)).toHaveLength(1);
  });

  it("u190_a_failed_call_keeps_the_text_and_shows_its_message", async () => {
    const { app } = await openShelf([padOf("notes", AGENT, "x")]);
    app.handlers["pad.ask"] = () => {
      throw new RpcError(-32000, "no scribe today");
    };

    await openPad("notes");

    const field = await input();

    type(field, "shorten");
    fireEvent.keyDown(field, { key: "Enter" });

    const line = await screen.findByText(/no scribe today/);

    expect([field.value, line.className, field.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING]).toEqual(["shorten", "ink", Node.DOCUMENT_POSITION_FOLLOWING]);
  });

  it("u190_exchange_lists_asks_and_replies_oldest_first_and_survives_a_reopen", async () => {
    const { app, connected } = await openShelf([padOf("notes", AGENT, "x")]);
    app.handlers["rail.tree"] = () => withScopeRow([{ id: SCRIBE.id, kind: "agent", name: "scribe", parent: null, order: 0, status: { kind: "needs-you", label: "?", since: 0 }, attempt: "1", status_revision: null, terminal_id: null, worktree: null, can_resume: false, channel: null, stray: [], work: null }]);
    await connected.rail.refresh();
    answering(app);
    const said = [note(1), note(2, { from: SCRIBE, to: "you", body: "done" })];
    app.handlers["message.list"] = () => said;
    await openPad("notes");
    const field = await input();

    type(field, "shorten");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe(""));
    app.handlers["pad.list"] = () => [{ ...padOf("notes", AGENT, "x"), scribe: SCRIBE.id }];
    app.emit({ actor: USER, name: "pad.changed", data: { name: "notes" } });
    app.emit({ actor: SCRIBE, name: "message.sent", data: note(2, { from: SCRIBE, to: "you", body: "done" }) });

    const rows = () => [...document.querySelectorAll(".pad-exchange li")].map((row) => row.textContent);

    await waitFor(() => expect(rows()).toEqual(["you shorten", "scribe done"]));

    connected.drawer.close();
    await waitFor(() => expect(document.querySelector(".pad-ask")).toBeNull());
    await openPad("notes");

    await waitFor(() => expect(rows()).toEqual(["you shorten", "scribe done"]));
  });

  it("u190_exchange_after_reopen_from_pad_scribe", async () => {
    const { app } = await openShelf([{ ...padOf("notes", AGENT, "x"), scribe: SCRIBE.id }]);
    app.handlers["message.list"] = () => [note(1), note(2, { from: SCRIBE, to: "you", body: "done" })];
    await openPad("notes");

    await waitFor(() => expect([...document.querySelectorAll(".pad-exchange li")].map((row) => row.textContent)).toEqual(["you shorten", "scribe-1 done"]));
    expect(asks(app.calls)).toEqual([]);
  });

  it("u190_exchange_scrolls_to_its_end_for_a_new_message", async () => {
    const { app } = await openShelf([padOf("notes", AGENT, "x")]);
    answering(app);
    await openPad("notes");
    const field = await input();
    type(field, "shorten");
    fireEvent.keyDown(field, { key: "Enter" });

    const list = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".pad-exchange");

      if (!found) throw new Error("no exchange");

      return found;
    });

    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 900 });
    app.emit({ actor: SCRIBE, name: "message.sent", data: note(2, { from: SCRIBE, to: "you", body: "done" }) });

    await waitFor(() => expect(list.scrollTop).toBe(900));
  });

  it("u190_a_scribe_write_refreshes_a_clean_user_pad", async () => {
    const { app, state } = await openShelf([padOf("notes", USER, "v1")]);
    const field = await openPad("notes");
    state.pads = [padOf("notes", USER, "v2")];

    app.emit({ actor: SCRIBE, name: "pad.changed", data: { name: "notes" } });

    await waitFor(() => expect(field.textContent).toContain("v2"));
  });

  it("u190_a_scribe_write_leaves_a_dirty_user_pad_with_changed_by", async () => {
    const { app, state } = await openShelf([padOf("notes", USER, "v1")]);
    app.handlers["rail.tree"] = () => withScopeRow([{ id: SCRIBE.id, kind: "agent", name: "scribe", parent: null, order: 0, status: { kind: "needs-you", label: "?", since: 0 }, attempt: "1", status_revision: null, terminal_id: null, worktree: null, can_resume: false, channel: null, stray: [], work: null }]);
    const field = await openPad("notes");
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value: "draft" } });
    state.pads = [padOf("notes", USER, "v2")];

    app.emit({ actor: SCRIBE, name: "pad.changed", data: { name: "notes" } });

    await screen.findByText(/changed by/);
    expect(field.value).toBe("draft");
  });

  it("u190_the_last_touch_line_is_a_sentence_in_font_ui", async () => {
    const { state } = await openShelf([padOf("notes", AGENT, "x")]);
    const at = new Date(2026, 0, 5, 20, 24).getTime();
    state.history = [{ actor: AGENT, verb: "wrote", item: "pad:notes", at }];

    await openPad("notes");
    const line = await screen.findByText(/ wrote this pad at /);
    const time = new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    expect([line.textContent, line.style.fontFamily]).toEqual([`auth-refactor wrote this pad at ${time}`, "var(--font-ui)"]);
  });

  it("u190_a_scribe_write_updates_the_last_touch_line", async () => {
    const { app, state } = await openShelf([padOf("notes", AGENT, "v1")]);
    const at = new Date(2026, 0, 5, 20, 24).getTime();
    state.history = [{ actor: USER, verb: "read", item: "pad:notes", at }];
    await openPad("notes");
    await screen.findByText(/you read this pad at /);
    state.history = [...state.history, { actor: SCRIBE, verb: "wrote", item: "pad:notes", at: at + 60000 }];
    state.pads = [padOf("notes", AGENT, "v2")];

    app.emit({ actor: SCRIBE, name: "pad.changed", data: { name: "notes" } });

    await screen.findByText(/ wrote this pad at /);
  });

  it("u190_agent_pad_edit_by_the_scribe_refreshes_and_scrolls_to_the_end", async () => {
    const { app, state } = await openShelf([padOf("notes", AGENT, "v1")]);
    answering(app);
    const field = await openPad("notes");
    Object.defineProperty(field, "scrollHeight", { configurable: true, get: () => 1510 });
    field.scrollTop = 1082;
    const ask = await input();
    type(ask, "shorten");
    fireEvent.keyDown(ask, { key: "Enter" });
    await waitFor(() => expect(ask.value).toBe(""));
    state.pads = [padOf("notes", AGENT, "v2")];

    app.emit({ actor: SCRIBE, name: "pad.changed", data: { name: "notes" } });

    await waitFor(() => expect(field.textContent).toContain("v2"));
    await waitFor(() => expect(field.scrollTop).toBe(1510));
  });

  it("u190_agent_pad_edit_by_another_actor_keeps_scrolltop", async () => {
    const { app, state } = await openShelf([padOf("notes", AGENT, "v1")]);
    const field = await openPad("notes");
    Object.defineProperty(field, "scrollHeight", { configurable: true, get: () => 1510 });
    field.scrollTop = 1082;
    state.pads = [padOf("notes", AGENT, "v2")];

    app.emit({ actor: AGENT, name: "pad.changed", data: { name: "notes" } });
    await waitFor(() => expect(field.textContent).toContain("v2"));

    expect(field.scrollTop).toBe(1082);
  });

  const scribeNode = (kind: "idle" | "working") => ({ id: SCRIBE.id, kind: "agent" as const, name: "scribe", parent: null, order: 0, status: { kind, label: kind, since: 0 }, attempt: "1", status_revision: "0", terminal_id: null, worktree: null, can_resume: true, channel: null, stray: [], work: null });

  const stops = (app: Awaited<ReturnType<typeof openShelf>>["app"]) => app.calls.filter((call) => call.method === "agent.stop").map((call) => call.params);

  it("u190_closing_the_drawer_stops_an_idle_scribe", async () => {
    const { app } = await openShelf([padOf("notes", AGENT, "x")]);
    answering(app);
    app.handlers["rail.tree"] = () => [scribeNode("idle")];
    app.handlers["agent.stop"] = () => null;
    await openPad("notes");
    const field = await input();
    type(field, "shorten");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(asks(app.calls)).toHaveLength(1));
    app.emit({ actor: SCRIBE, name: "rail.changed" });
    await waitFor(() => expect(app.calls.some((call) => call.method === "rail.tree")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    await waitFor(() => expect(stops(app)).toEqual([{ id: SCRIBE.id }]));
  });

  it("u190_a_working_scribe_is_stopped_when_it_next_goes_idle", async () => {
    const { app } = await openShelf([padOf("notes", AGENT, "x")]);
    answering(app);
    let kind: "idle" | "working" = "working";
    app.handlers["rail.tree"] = () => [scribeNode(kind)];
    app.handlers["agent.stop"] = () => null;
    await openPad("notes");
    const field = await input();
    type(field, "shorten");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(asks(app.calls)).toHaveLength(1));
    app.emit({ actor: SCRIBE, name: "rail.changed" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stops(app)).toEqual([]);

    kind = "idle";
    app.emit({ actor: SCRIBE, name: "agent.status", data: { id: SCRIBE.id, attempt: "1", status: { kind: "idle", label: "idle", since: 1 }, status_revision: "1" } });

    await waitFor(() => expect(stops(app)).toEqual([{ id: SCRIBE.id }]));
  });

  it("u190_reopening_the_drawer_cancels_the_pending_stop", async () => {
    const { app, connected } = await openShelf([{ ...padOf("notes", AGENT, "x"), scribe: SCRIBE.id }]);
    let kind: "idle" | "working" = "working";
    app.handlers["rail.tree"] = () => [scribeNode(kind)];
    app.handlers["agent.stop"] = () => null;
    await connected.rail.refresh();
    await openPad("notes");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => expect(document.querySelector(".pad-ask")).toBeNull());
    await openPad("notes");

    kind = "idle";
    app.emit({ actor: SCRIBE, name: "agent.status", data: { id: SCRIBE.id, attempt: "1", status: { kind: "idle", label: "idle", since: 1 }, status_revision: "1" } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stops(app)).toEqual([]);
  });

  it("u190_a_daemon_that_stops_mid_check_leaves_no_unhandled_rejection", async () => {
    const unhandled: Error[] = [];
    const record = (reason: Error) => unhandled.push(reason);

    process.on("unhandledRejection", record);


    try {
      const { app, connected } = await openShelf([{ ...padOf("notes", AGENT, "x"), scribe: SCRIBE.id }]);

      app.handlers["rail.tree"] = () => [scribeNode("idle")];
      await connected.rail.refresh();
      await openPad("notes");
      // The Daemon goes away: every call from here on rejects.
      app.handlers["rail.tree"] = () => {
        throw new Error("fetch failed");
      };

      app.handlers["agent.stop"] = () => {
        throw new Error("fetch failed");
      };

      fireEvent.click(screen.getByRole("button", { name: "close" }));
      await waitFor(() => expect(document.querySelector(".pad-ask")).toBeNull());
      app.emit({ actor: SCRIBE, name: "rail.changed" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("u190_a_touch_line_read_that_the_daemon_drops_leaves_no_unhandled_rejection", async () => {
    const unhandled: Error[] = [];
    const record = (reason: Error) => unhandled.push(reason);

    process.on("unhandledRejection", record);


    try {
      const { app } = await openShelf([padOf("notes", AGENT, "x")]);

      await openPad("notes");
      app.handlers["provenance.history"] = () => {
        throw new Error("fetch failed");
      };

      app.emit({ actor: SCRIBE, name: "pad.changed", data: { name: "notes" } });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});
