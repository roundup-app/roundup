import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door, event, NOW, USER } from "../testing/nodes";
import { message, mountThread, sent } from "./threadFixture";

const tree = () => [
  door("r1", "idle", "idle", { name: "lead" }),
  agent("a", "working", "x", { parent: "r1", name: "ann" }),
  agent("b", "working", "x", { parent: "r1", name: "bob" }),
  agent("c", "working", "x", { parent: "r1", name: "cy" }),
];

const A = { kind: "agent", id: "a", parent: "r1" } as const;

const B = { kind: "agent", id: "b", parent: "r1" } as const;

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const senders = () => [...document.querySelectorAll("[data-message-sender]")].map((each) => each.textContent);

const bodies = () => [...document.querySelectorAll<HTMLElement>("[data-message-body]")];

const feed = () => screen.getByRole("log").textContent ?? "";

afterEach(cleanup);

describe("u189 the Thread reads as a conversation", () => {
  it("u189_runs_collapse_to_one_sender_line_and_the_time_is_hh_mm", async () => {
    await mountThread(tree(), { messages: [message(1, { from: USER, to: "r1" }), message(2, { from: USER, to: "r1" }), message(3, { from: DOOR, to: "you" }), message(4, { from: USER, to: "r1" })] });
    await vi.waitFor(() => expect(senders()).toHaveLength(3));

    const time = new Date(NOW);
    const hhmm = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;

    expect(senders()).toEqual([`you ${hhmm}`, `lead ${hhmm}`, `you ${hhmm}`]);
    expect(document.querySelector(".thread-run")!.querySelectorAll("[data-message-body]")).toHaveLength(2);
  });

  it("u189_a_delivered_message_draws_no_status_and_held_dropped_and_pending_do", async () => {
    await mountThread(tree(), {
      messages: [message(1, { from: DOOR, to: "you" }), message(2, { from: DOOR, to: "you", status: "held" }), message(3, { from: DOOR, to: "you", status: "dropped" }), message(4, { from: DOOR, to: "you", status: "pending" })],
    });
    await vi.waitFor(() => expect(bodies()).toHaveLength(4));

    expect(feed().replace("not delivered", "")).not.toContain("delivered");
    expect([...document.querySelectorAll("[data-log] [data-message-status]")].map((each) => each.textContent)).toEqual(["waiting for approval", "not delivered", "pending"]);
    expect(bodies()[0]!.getAttribute("data-status")).toBe("delivered");
  });

  it("u189_a_note_has_no_kind_word_and_no_to_you_and_a_question_to_you_is_a_card_without_one", async () => {
    await mountThread(tree(), { messages: [message(1, { from: DOOR, to: "you", body: "fyi" }), message(2, { from: DOOR, to: "you", kind: "question", body: "which?" })] });
    await vi.waitFor(() => expect(document.querySelector("[data-message-card]")).not.toBeNull());

    expect(feed()).not.toMatch(/note|question|→/);
    // U355: the question is the Card above the log and also a plain body in the log.
    expect(bodies()).toHaveLength(2);
    expect(document.querySelector("[data-message-card] [data-message-sender]")).not.toBeNull();
    expect(document.querySelectorAll("[data-message-sender]")).toHaveLength(2);
  });

  it("u189_a_question_between_agents_shows_a_mark_and_a_message_to_a_third_agent_names_it", async () => {
    await mountThread(tree(), { messages: [message(1, { from: A, to: "b", kind: "question", body: "why?" }), message(2, { from: B, to: "c", body: "see" })] });
    await vi.waitFor(() => expect(senders()).toHaveLength(2));

    expect(senders()[0]).toMatch(/^\? ann → bob /);
    expect(senders()[1]).toMatch(/^bob → cy /);
    expect(feed()).not.toContain("question");
  });

  it("u189_one_sender_writing_to_the_door_then_to_a_third_agent_starts_a_new_run_naming_it", async () => {
    await mountThread(tree(), { messages: [message(1, { from: B, to: "r1", body: "to door" }), message(2, { from: B, to: "c", body: "to cy" })] });
    await vi.waitFor(() => expect(senders()).toHaveLength(2));

    expect(senders()[0]).toMatch(/^bob \d/);
    expect(senders()[1]).toMatch(/^bob → cy /);
  });

  it("u189_a_fold_opens_on_click_and_folds_on_a_second_without_touching_the_others_or_ctrl_o", async () => {
    const first = `${"a".repeat(35)}\n${"b".repeat(35)}`;
    const second = `${"c".repeat(35)}\n${"d".repeat(35)}`;

    await mountThread(tree(), { messages: [message(1, { body: first }), message(2, { body: second })] });

    const buttons = await screen.findAllByRole("button", { name: /…$/ });

    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[0]!.textContent).toBe(`${"a".repeat(35)} ${"b".repeat(24)}…`);

    fireEvent.click(buttons[0]!);

    expect(bodies()[0]!.textContent).toBe(first);
    expect(bodies()[0]!.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(bodies()[1]!.textContent).toMatch(/…$/);

    fireEvent.click(bodies()[0]!.querySelector("button")!);

    expect(bodies()[0]!.textContent).toMatch(/…$/);

    fireEvent.click(bodies()[0]!.querySelector("button")!);
    fireEvent.keyDown(screen.getByRole("log"), { key: "o", code: "KeyO", ctrlKey: true });

    expect(bodies().map((each) => each.textContent)).toEqual([first, second]);

    fireEvent.keyDown(screen.getByRole("log"), { key: "o", code: "KeyO", ctrlKey: true });

    expect(bodies().every((each) => (each.textContent ?? "").endsWith("…"))).toBe(true);
  });

  it("u189_a_body_of_40_characters_has_no_ellipsis_and_no_button", async () => {
    await mountThread(tree(), { messages: [message(1, { body: "m".repeat(40) })] });
    await vi.waitFor(() => expect(bodies()).toHaveLength(1));

    expect(bodies()[0]!.textContent).toBe("m".repeat(40));
    expect(screen.queryByRole("button", { name: /m{40}/ })).toBeNull();
  });

  it("u189_bodies_are_ui_font_left_wrapped_and_the_feed_is_a_log", async () => {
    await mountThread(tree(), { messages: [message(1, { from: USER, to: "r1", body: `${"w".repeat(200)}\nsecond` }), message(2, { from: DOOR, to: "you", kind: "question", body: "which?" })] });
    await vi.waitFor(() => expect(bodies()).toHaveLength(2));

    const targets = [...bodies(), document.querySelector<HTMLElement>(".thread-card-body")!];

    for (const each of targets) {
      const style = getComputedStyle(each);

      expect(style.fontFamily).toBe("var(--font-ui)");
      expect(style.textAlign).toBe("left");
      expect(style.whiteSpace).toBe("pre-wrap");
    }

    expect(bodies()[0]!.textContent).toBe(`${"w".repeat(200)}\nsecond`);
    expect(getComputedStyle(document.querySelector("[data-message-sender]")!).color).toBe("var(--grey)");
    expect(screen.getByRole("log").getAttribute("aria-label")).toBe("thread");
  });

  it("u189_a_message_arriving_by_event_joins_the_open_run", async () => {
    const { app } = await mountThread(tree(), { messages: [message(1, { from: USER, to: "r1" })] });
    await vi.waitFor(() => expect(bodies()).toHaveLength(1));

    app.emit(sent(message(2, { from: USER, to: "r1", body: "next" })));
    await vi.waitFor(() => expect(bodies()).toHaveLength(2));

    expect(senders()).toHaveLength(1);

    app.emit(event({ name: "message.delivered", data: message(2, { from: USER, to: "r1", body: "next" }) }));

    expect(senders()).toHaveLength(1);
  });

  it("u189_design_system_rules_table_holds_the_row", () => {
    const table = readFileSync(resolve(process.cwd(), "../../docs/design-system.md"), "utf8");

    expect(table).toMatch(/^\| \d+ \| A word shown on every row appears only when it differs from what the reader expects\. \| U189 \|$/m);
  });
});
