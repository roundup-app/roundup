import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread, sent, threadInput } from "./threadFixture";

const tree = () => [
  door("r1", "idle", "idle", { name: "one" }),
  agent("a1", "working", "x", { parent: "r1", name: "ann" }),
  door("r2", "idle", "idle", { name: "two" }),
];

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const ask = (id: number, over = {}) => message(id, { from: DOOR, to: "you", kind: "question", body: "goal?\n(1) a\n(2) b", ...over });

const cards = () => [...document.querySelectorAll<HTMLElement>("[data-message-card]")];

const sends = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "message.send").map((call) => call.params);

afterEach(cleanup);

describe("u192 a Door's question to you is a Card the user answers", () => {
  it("u192_a_question_is_a_card_with_its_lines_kept_and_a_note_has_no_answer", async () => {
    await mountThread(tree(), { messages: [ask(1), ask(2, { kind: "note", body: "fyi" })] });
    await vi.waitFor(() => expect(cards()).toHaveLength(1));

    const body = cards()[0]!.querySelector(".thread-card-body")!;

    expect(body.textContent?.split("\n")).toEqual(["goal?", "(1) a", "(2) b"]);
    expect(within(cards()[0]!).getByRole("button", { name: "answer" })).toBeTruthy();
    // U189: a note to the user is a plain body in its run, with nothing to answer.
    expect(screen.getAllByRole("button", { name: "answer" })).toHaveLength(1);
    // U355: the question also stands in the full log as a plain body.
    expect(document.querySelectorAll("[data-message-body]")).toHaveLength(2);
  });

  it("u192_a_question_between_two_agents_stays_a_folded_line", async () => {
    await mountThread(tree(), { messages: [message(1, { from: DOOR, to: "a1", kind: "question", body: "why?" })] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-message-body]")).toHaveLength(1));

    expect(cards()).toHaveLength(0);
  });

  it("u192_answer_by_pointer_sends_a_reply_to_the_question_and_then_shows_answered", async () => {
    const { app } = await mountThread(tree(), { messages: [ask(5)] });
    const button = await screen.findByRole("button", { name: "answer" });

    fireEvent.click(button);

    expect(document.activeElement).toBe(threadInput());
    expect(document.querySelector("[data-answering]")?.textContent).toContain("answering one");

    fireEvent.input(threadInput(), { target: { value: "ship it" } });
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await vi.waitFor(() => expect(sends(app)).toHaveLength(1));

    expect(sends(app)[0]).toEqual({ to: "r1", kind: "note", body: "ship it", replyTo: 5 });

    app.emit(sent(message(99, { from: USER, to: "r1", body: "ship it", replyTo: 5 })));
    app.emit(sent(message(100, { from: USER, to: "r1", body: "again", replyTo: 5 })));
    await vi.waitFor(() => expect(cards()[0]!.querySelectorAll("[data-answered]")).toHaveLength(1));

    expect(screen.queryByRole("button", { name: "answer" })).toBeNull();
    expect(document.querySelector("[data-answering]")).toBeNull();

    fireEvent.input(threadInput(), { target: { value: "next" } });
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await vi.waitFor(() => expect(sends(app)).toHaveLength(2));

    expect(sends(app)[1]).toEqual({ to: "r1", kind: "note", body: "next", replyTo: null });
  });

  it("u192_answered_is_read_from_the_list_after_a_remount", async () => {
    await mountThread(tree(), { messages: [ask(5), message(6, { from: USER, to: "r1", replyTo: 5 })] });
    await vi.waitFor(() => expect(cards()[0]?.querySelector("[data-answered]")).not.toBeNull());
  });

  it("u192_a_dismissed_mark_sends_no_reply_to", async () => {
    const { app } = await mountThread(tree(), { messages: [ask(5)] });

    fireEvent.click(await screen.findByRole("button", { name: "answer" }));
    fireEvent.click(screen.getByRole("button", { name: "dismiss answer" }));
    fireEvent.input(threadInput(), { target: { value: "hi" } });
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await vi.waitFor(() => expect(sends(app)).toHaveLength(1));

    expect(sends(app)[0]).toEqual({ to: "r1", kind: "note", body: "hi", replyTo: null });
  });

  it("u192_switching_workstream_clears_the_mark", async () => {
    const { connected } = await mountThread(tree(), { messages: [ask(5)] });

    fireEvent.click(await screen.findByRole("button", { name: "answer" }));
    connected.rail.select("r2");
    await vi.waitFor(() => expect(document.querySelector("[data-answering]")).toBeNull());
  });

  it("u192_a_long_failure_wraps_and_holds_the_whole_message_in_its_title", async () => {
    const text = `${"boom ".repeat(40)}\nsecond line`;

    const { app } = await mountThread(tree());

    app.handlers["message.send"] = () => {
      throw new Error(text);
    };

    fireEvent.input(threadInput(), { target: { value: "x" } });
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await vi.waitFor(() => expect(document.querySelector(".thread-failure-text")).not.toBeNull());

    const line = document.querySelector<HTMLElement>(".thread-failure-text")!;

    expect(line.getAttribute("title")).toBe(text);
    expect(line.textContent).toContain("second line");
    expect(getComputedStyle(line).whiteSpace).toBe("pre-wrap");
  });
});
