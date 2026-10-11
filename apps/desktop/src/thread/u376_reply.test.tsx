import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread, sent } from "./threadFixture";

const tree = (kind: "needs-you" | "working" = "needs-you") => [door("r1", "idle", "idle", { name: "one" }), agent("a1", kind, "x", { parent: "r1", name: "ann" })];

const CHILD = { kind: "agent", id: "a1", parent: "r1" } as const;

const reply = () => document.querySelector<HTMLElement>("[data-reply]");

const twelve = Array.from({ length: 12 }, (_, at) => `line ${at + 1}`).join("\n");

const calls = (app: { calls: { method: string }[] }, method: string) => app.calls.filter((call) => call.method === method);

afterEach(cleanup);

describe("u376 the Door's Thread shows a Subagent's latest reply", () => {
  it("u376_the_newest_message_of_a_subagent_shows_under_its_now_line", async () => {
    const { app } = await mountThread(tree(), { messages: [message(1, { from: CHILD, to: "r1", body: "first\nmore" })] });

    await vi.waitFor(() => expect(reply()).not.toBeNull());

    expect(reply()!.dataset.kind).toBe("needs-you");
    expect(reply()!.textContent).toContain("first");
    expect(reply()!.textContent).not.toContain("more");
    expect(reply()!.querySelector("[title]")!.getAttribute("title")).toBe("first\nmore");

    app.emit(sent(message(2, { from: CHILD, to: "r1", body: "second" })));
    await vi.waitFor(() => expect(reply()!.textContent).toContain("second"));

    expect(document.querySelectorAll("[data-reply]")).toHaveLength(1);
  });

  it("u376_a_subagent_that_sent_none_shows_no_reply", async () => {
    await mountThread(tree());
    await vi.waitFor(() => expect(document.querySelector("[data-now='a1']")).not.toBeNull());

    expect(reply()).toBeNull();
  });

  it("u376_an_unanswered_question_shows_in_full_with_answer", async () => {
    await mountThread(tree(), { messages: [message(1, { from: CHILD, to: "r1", kind: "question", body: twelve })] });
    await vi.waitFor(() => expect(reply()).not.toBeNull());

    expect(reply()!.textContent).toContain("line 12");
    expect(screen.getAllByRole("button", { name: "answer" })).toHaveLength(1);
  });

  it("u376_a_note_or_an_answered_question_offers_no_answer", async () => {
    const { app } = await mountThread(tree(), { messages: [message(1, { from: CHILD, to: "r1", kind: "note", body: "fyi" })] });

    await vi.waitFor(() => expect(reply()).not.toBeNull());
    expect(screen.queryByRole("button", { name: "answer" })).toBeNull();

    app.emit(sent(message(2, { from: CHILD, to: "r1", kind: "question", body: "which?" })));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "answer" })).not.toBeNull());

    app.emit(sent(message(3, { from: USER, to: "a1", replyTo: 2 })));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "answer" })).toBeNull());

    expect(reply()!.textContent).toContain("answered");
  });

  it("u376_answer_sends_one_note_with_reply_to_and_no_takeover", async () => {
    const { app } = await mountThread(tree(), { messages: [message(1, { from: CHILD, to: "r1", kind: "question", body: "which?" })] });
    const field = await screen.findByLabelText("answer");

    fireEvent.input(field, { target: { value: "this one" } });

    const button = screen.getByRole("button", { name: "answer" });

    fireEvent.click(button);
    fireEvent.click(button);
    await vi.waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));

    expect(app.calls.find((call) => call.method === "message.send")?.params).toEqual({ to: "a1", kind: "note", body: "this one", replyTo: 1 });
    expect(calls(app, "terminal.write")).toHaveLength(0);
    expect(calls(app, "takeover.begin")).toHaveLength(0);
  });

  it("u376_typed_text_survives_another_message_arriving", async () => {
    const other = { kind: "agent", id: "a2", parent: "r1" } as const;
    const { app } = await mountThread([...tree(), agent("a2", "working", "y", { parent: "r1", name: "bob" })], { messages: [message(1, { from: CHILD, to: "r1", kind: "question", body: "which?" })] });
    const field = await screen.findByLabelText("answer");

    fireEvent.input(field, { target: { value: "half typed" } });
    app.emit(sent(message(2, { from: other, to: "r1", kind: "note", body: "unrelated" })));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-reply]")).toHaveLength(2));

    expect(screen.getByLabelText("answer")).toBe(field);
    expect(screen.getByDisplayValue("half typed")).toBe(field);
  });

  it("u376_a_rejected_answer_keeps_the_text_and_retries", async () => {
    const { app } = await mountThread(tree(), { messages: [message(1, { from: CHILD, to: "r1", kind: "question", body: "which?" })] });
    let fail = true;

    app.handlers["message.send"] = (params) => {
      if (fail) throw new Error("no route");

      return message(99, { from: USER, to: params.to, body: params.body });
    };

    const field = await screen.findByLabelText<HTMLTextAreaElement>("answer");

    fireEvent.input(field, { target: { value: "this one" } });
    fireEvent.click(screen.getByRole("button", { name: "answer" }));
    await screen.findByText("no route");

    expect(field.value).toBe("this one");

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await vi.waitFor(() => expect(calls(app, "message.send")).toHaveLength(2));
  });

  it("u376_u354_and_u355_hold_unchanged", async () => {
    await mountThread(tree(), { messages: [message(1, { from: CHILD, to: "r1", kind: "question", body: "which?" })] });
    await vi.waitFor(() => expect(reply()).not.toBeNull());

    expect(document.querySelectorAll("[data-message-card]")).toHaveLength(0);
    expect(document.querySelector(".thread-log-count")!.textContent).toBe("1");
  });
});
