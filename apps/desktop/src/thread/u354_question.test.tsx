import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread, sent, threadInput } from "./threadFixture";

const tree = () => [door("r1", "idle", "idle", { name: "one" }), agent("a1", "working", "x", { parent: "r1", name: "ann" })];

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const CHILD = { kind: "agent", id: "a1", parent: "r1" } as const;

const cards = () => [...document.querySelectorAll<HTMLElement>("[data-message-card]")];

const words = () => [...document.querySelectorAll("[data-message-status]")].map((each) => each.textContent);

afterEach(cleanup);

describe("u354 a question shows once, in full, and asks the user only when it is to you", () => {
  it("u354_a_question_between_agents_never_offers_answer", async () => {
    await mountThread(tree(), {
      messages: [
        message(1, { from: DOOR, to: "a1", kind: "question", body: "Is the screenshot on #770?" }),
        message(2, { from: CHILD, to: "r1", kind: "question", body: "which one?" }),
        message(3, { from: DOOR, to: "a1", kind: "question", body: "held for you?", status: "held", reason: "escalated" }),
      ],
    });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-message-body]")).toHaveLength(3));

    expect(cards()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "answer" })).toBeNull();
  });

  it("u354_a_question_shows_once_across_events_and_a_reload", async () => {
    const asked = message(1, { from: DOOR, to: "a1", kind: "question", body: "Is the screenshot on #770?" });
    const { app } = await mountThread(tree(), { messages: [asked] });

    await vi.waitFor(() => expect(document.querySelectorAll("[data-message-body]")).toHaveLength(1));
    app.emit(sent(asked));
    app.emit(sent({ ...asked, status: "delivered", at: asked.at + 60_000 }));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-message-body]")).toHaveLength(1));

    expect(document.body.textContent?.split("Is the screenshot on #770?")).toHaveLength(2);
    expect(cards()).toHaveLength(0);
  });

  it("u354_a_question_answered_by_anyone_shows_answered_and_no_answer", async () => {
    const ask = (id: number) => message(id, { from: DOOR, to: "you", kind: "question", body: `q${id}` });

    const { app } = await mountThread(tree(), {
      messages: [ask(1), ask(2), ask(3), message(4, { from: USER, to: "r1", replyTo: 1 }), message(5, { from: CHILD, to: "r1", replyTo: 2 })],
    });

    await vi.waitFor(() => expect(cards()).toHaveLength(3));

    const marks = () => cards().map((card) => card.querySelector("[data-answered]") !== null);

    expect(marks()).toEqual([true, true, false]);
    expect(screen.getAllByRole("button", { name: "answer" })).toHaveLength(1);

    app.emit(sent(message(6, { from: DOOR, to: "r1", replyTo: 3 })));
    await vi.waitFor(() => expect(marks()).toEqual([true, true, true]));

    expect(screen.queryByRole("button", { name: "answer" })).toBeNull();
  });

  it("u354_a_question_to_you_still_offers_answer_with_reply_to", async () => {
    const { app } = await mountThread(tree(), { messages: [message(7, { from: DOOR, to: "you", kind: "question", body: "go?" })] });

    fireEvent.click(await screen.findByRole("button", { name: "answer" }));
    fireEvent.input(threadInput(), { target: { value: "yes" } });
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await vi.waitFor(() => expect(app.calls.some((call) => call.method === "message.send")).toBe(true));

    expect(app.calls.find((call) => call.method === "message.send")?.params).toEqual({ to: "r1", kind: "note", body: "yes", replyTo: 7 });
  });

  it("u354_a_pinned_question_shows_its_last_line_above_the_order_line", async () => {
    const question = Array.from({ length: 12 }, (_, at) => `line ${at + 1}`).join("\n");

    await mountThread([door("r1", "working", "working", { name: "w", work: { kind: "clarification", question } })]);

    const ask = document.querySelector<HTMLElement>(".thread-ask")!;

    expect(ask.textContent).toContain("line 12");
    expect(ask.dataset.full).toBe("");
    expect(getComputedStyle(ask).getPropertyValue("-webkit-line-clamp")).not.toBe("2");
  });

  it("u354_held_and_dropped_read_in_plain_words_with_the_users_action", async () => {
    const held = (id: number, reason: "escalated" | "ask-first" | "takeover") => message(id, { from: USER, to: "r1", status: "held", reason });

    await mountThread(tree(), {
      messages: [
        held(1, "escalated"),
        held(2, "ask-first"),
        held(3, "takeover"),
        message(4, { from: USER, to: "r1", status: "dropped", reason: "receiver gone" }),
        message(5, { from: USER, to: "r1", status: "dropped", reason: "not accepted" }),
      ],
    });
    await vi.waitFor(() => expect(words()).toHaveLength(5));

    expect(words()).toEqual([
      "waiting for you: answer below",
      "waiting for approval",
      "waiting until the takeover ends",
      "not delivered: the receiver is gone",
      "not delivered: the receiver did not accept it",
    ]);
    expect(document.body.textContent).not.toMatch(/\b(held|dropped)\b/);
  });
});
