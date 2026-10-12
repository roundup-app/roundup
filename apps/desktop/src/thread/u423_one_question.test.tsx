import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import type { Decision } from "@contracts/decision/Decision";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askingWith, decision, opened } from "../decisions/decisionsFixture";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread, sent, threadInput } from "./threadFixture";

const tree = () => [door("r1", "needs-you", "asks", { name: "lead" }), agent("a", "needs-you", "asks", { parent: "r1", name: "ann" })];

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const first = askingWith("d1", "a", "Which view?", [{ label: "A · Brief", description: "one state" }, { label: "B · Log", description: "all of it" }]);

const second = askingWith("d2", "r1", "Which name?", [{ label: "X", description: "x" }]);

const mount = (decisions: Decision[], extra: Parameters<typeof mountThread>[1] = {}) =>
  mountThread(tree(), {
    ...extra,
    prepare: (app) => {
      app.handlers["decision.list"] = () => decisions;
      app.handlers["decision.answer"] = () => null;
    },
  });

const question = () => document.querySelector<HTMLElement>("[data-question]");

const answers = (app: Awaited<ReturnType<typeof mount>>["app"]) => app.calls.filter((call) => call.method === "decision.answer").map((call) => call.params);

afterEach(cleanup);

describe("u423 one question leads the view, and leaves when the user sends", () => {
  it("u423_the_oldest_ask_user_decision_leads_and_the_next_follows", async () => {
    const { app } = await mount([{ ...second, opened_at: 2 }, { ...first, opened_at: 1 }, decision("d3", "a", { opened_at: 0 })]);

    await vi.waitFor(() => expect(question()?.getAttribute("data-question")).toBe("d1"));

    expect(question()!.querySelector(".decision-title")!.textContent).toBe("ann asks");
    expect(document.querySelectorAll("[data-question]")).toHaveLength(1);

    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await vi.waitFor(() => expect(answers(app)).toHaveLength(1));

    expect(answers(app)[0]).toMatchObject({ id: "d1", answer: "A · Brief" });

    app.emit(opened({ ...first, opened_at: 1 }));
    app.emit({ actor: USER, name: "decision.cleared", data: { id: "d1", outcome: "answered" } });
    await vi.waitFor(() => expect(question()?.getAttribute("data-question")).toBe("d2"));
    expect(question()!.querySelector(".decision-title")!.textContent).toBe("lead asks");
  });

  it("u423_one_field_serves_the_open_question", async () => {
    const { app } = await mount([first]);

    await vi.waitFor(() => expect(question()).not.toBeNull());

    expect(threadInput().placeholder).toBe("Note for A · Brief, or your own answer");
    expect(question()!.querySelectorAll("input, textarea")).toHaveLength(0);
    expect(document.querySelectorAll("input, textarea")).toHaveLength(1);

    fireEvent.input(threadInput(), { target: { value: "ship it" } });
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await vi.waitFor(() => expect(answers(app)).toHaveLength(1));

    expect(answers(app)[0]).toMatchObject({ id: "d1", answer: "A · Brief", note: "ship it" });
  });

  it("u423_a_question_message_leaves_when_the_user_sends_its_sender_any_message", async () => {
    const { app } = await mount([], { messages: [message(1, { from: DOOR, to: "you", kind: "question", body: "go on?" })] });

    await vi.waitFor(() => expect(document.querySelectorAll("[data-need]")).toHaveLength(1));

    app.emit(sent(message(2, { from: USER, to: "a", body: "elsewhere" })));
    expect(document.querySelectorAll("[data-need]")).toHaveLength(1);

    app.emit(sent(message(3, { from: USER, to: "r1", body: "typed in the composer", replyTo: null })));
    await vi.waitFor(() => expect(document.querySelector("[data-need]")).toBeNull());
  });

  it("u423_no_answer_control_remains_once_sent", async () => {
    await mount([], { messages: [message(1, { from: DOOR, to: "you", kind: "question", body: "go on?" }), message(2, { from: USER, to: "r1", body: "yes" })] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-message-body]").length).toBeGreaterThan(0));

    expect(screen.queryByRole("button", { name: "answer" })).toBeNull();
    expect(document.body.textContent).not.toContain("answered");
  });

  it("u423_a_question_leaving_moves_no_row_above", async () => {
    const { app } = await mount([], { messages: [message(1, { from: DOOR, to: "you", kind: "question", body: "go on?" })] });

    await vi.waitFor(() => expect(document.querySelector("[data-need]")).not.toBeNull());

    const column = document.querySelector(".thread-feed")!;
    const need = document.querySelector("[data-need]")!;
    const above = () => [...column.children].slice(0, [...column.children].indexOf(need)).map((el) => el.outerHTML);

    const before = above();

    app.emit(sent(message(3, { from: USER, to: "r1", body: "done" })));
    await vi.waitFor(() => expect(document.querySelector("[data-need]")).toBeNull());

    expect([...column.children].map((el) => el.outerHTML).slice(0, before.length)).toEqual(before);
  });
});
