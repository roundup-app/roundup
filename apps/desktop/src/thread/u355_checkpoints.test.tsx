import { cleanup, fireEvent, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import type { MermaidApi } from "../pads/mermaidBlock";
import { bundledRenderers, useRenderers } from "../pads/visualKinds";
import { agent, door, event, NOW, USER } from "../testing/nodes";
import { message, mountThread, sent } from "./threadFixture";

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const fake: MermaidApi = {
  initialize: () => {},
  parse: async (text) => {
    if (text.includes("bad")) throw new Error("Parse error on line 1\n  code frame");
  },
  render: async () => ({ svg: "<svg><text>drawn</text></svg>" }),
};

beforeEach(() => useRenderers({ ...bundledRenderers, mermaid: async () => fake }));

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
});

const tree = () => [door("r1", "working", "x", { name: "lead" }), agent("a", "working", "y", { parent: "r1", name: "ann" })];

const first: Checkpoint = {
  id: 1,
  workstream: "r1",
  at: NOW,
  title: "Tour done",
  blocks: [
    { kind: "rows", title: "Achieved", rows: [{ label: "tests", value: "green" }, { label: "gate", value: "just check" }] },
    { kind: "table", head: ["agent", "state"], rows: [["ann", "working"]] },
  ],
};

const second: Checkpoint = {
  id: 2,
  workstream: "r1",
  at: NOW,
  title: "Next",
  blocks: [{ kind: "diagram", mermaid: "graph TD\nA-->B" }, { kind: "text", text: "watch the build" }],
};

const messages = () => [
  message(1, { from: DOOR, to: "you", kind: "question", body: "which?" }),
  message(2, { from: DOOR, to: "you", status: "held", body: "held note" }),
  message(3, { from: USER, to: "r1", body: "mine" }),
  message(4, { from: DOOR, to: "a", status: "held", body: "copy" }),
  message(5, { from: DOOR, to: "a", status: "dropped", body: "gone" }),
  message(6, { from: DOOR, to: "a", body: "go on" }),
  message(7, { from: USER, to: "r1", status: "pending", body: "later" }),
];

const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

describe("u355 the Door's Thread reads as a timeline of checkpoints", () => {
  it("u355_the_thread_reads_status_needs_checkpoints_then_the_fold", async () => {
    await mountThread(tree(), { messages: messages(), checkpoints: [first] });
    await vi.waitFor(() => expect(document.querySelector("[data-checkpoint]")).not.toBeNull());

    const order = ["[data-now]", "[data-needs]", "[data-checkpoints]", "[data-log]", "[data-thread-input]"].map((each) => q(each));

    order.slice(1).forEach((each, at) => expect(order[at]!.compareDocumentPosition(each) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(q(".thread-header").compareDocumentPosition(order[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u355_what_needs_the_user_sits_above_the_checkpoints", async () => {
    await mountThread(tree(), { messages: messages(), checkpoints: [first] });
    await vi.waitFor(() => expect(document.querySelector("[data-needs]")).not.toBeNull());

    const needs = q("[data-needs]");

    expect([...needs.querySelectorAll("[data-message-card]")].map((each) => each.getAttribute("data-message"))).toEqual(["1", "2"]);
    expect(within(needs).getAllByRole("button", { name: "answer" })).toHaveLength(2);
    expect(needs.textContent).not.toContain("Tour done");
    expect(needs.compareDocumentPosition(q("[data-checkpoints]")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u355_nothing_waiting_draws_no_needs_region", async () => {
    await mountThread(tree(), { messages: [message(6, { from: DOOR, to: "a" }), message(8, { from: DOOR, to: "you", kind: "question", body: "done?" }), message(9, { from: USER, to: "r1", replyTo: 8 })] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-message-body]").length).toBeGreaterThan(0));

    expect(document.querySelector("[data-needs]")).toBeNull();
  });

  it("u355_each_block_kind_draws_in_the_doors_order", async () => {
    await mountThread(tree(), { checkpoints: [first, second] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-checkpoint]")).toHaveLength(2));

    const cards = [...document.querySelectorAll<HTMLElement>("[data-checkpoint]")];

    expect(cards.map((each) => each.getAttribute("data-checkpoint"))).toEqual(["2", "1"]);
    expect(cards[1]!.querySelector(".checkpoint-title")!.textContent).toBe("Tour done");
    expect(cards[1]!.querySelector("time")!.textContent).toMatch(/^\d\d:\d\d$/);
    expect([...cards[1]!.querySelectorAll("[data-block]")].map((each) => each.getAttribute("data-block"))).toEqual(["rows", "table"]);
    expect(cards[1]!.querySelector(".checkpoint-block-title")!.textContent).toBe("Achieved");
    expect([...cards[1]!.querySelectorAll("dt, dd")].map((each) => each.textContent)).toEqual(["tests", "green", "gate", "just check"]);
    expect([...cards[1]!.querySelectorAll("th")].map((each) => each.textContent)).toEqual(["agent", "state"]);
    expect(cards[1]!.querySelectorAll("td")).toHaveLength(2);
    await vi.waitFor(() => expect(cards[0]!.querySelector("svg")).not.toBeNull());
    expect([...cards[0]!.querySelectorAll("[data-block]")].map((each) => each.getAttribute("data-block"))).toEqual(["diagram", "text"]);
    expect(cards[0]!.querySelector("p.checkpoint-text")!.textContent).toBe("watch the build");
  });

  it("u355_a_failed_diagram_shows_its_source", async () => {
    await mountThread(tree(), { checkpoints: [{ ...second, blocks: [{ kind: "diagram", mermaid: "bad graph" }] }] });
    await vi.waitFor(() => expect(document.querySelector("[data-block-diagram] .visual-error")).not.toBeNull());

    expect(q("[data-block-diagram] pre").textContent).toBe("bad graph");
  });

  it("u355_checkpoint_text_is_never_html", async () => {
    await mountThread(tree(), { checkpoints: [{ ...first, title: "<b>t</b>", blocks: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }, { kind: "rows", rows: [{ label: "<i>l</i>", value: "<u>v</u>" }] }] }] });
    await vi.waitFor(() => expect(document.querySelector("[data-checkpoint]")).not.toBeNull());

    const card = q("[data-checkpoint]");

    expect(card.querySelector("img, b, i, u")).toBeNull();
    expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(card.querySelector(".checkpoint-title")!.textContent).toBe("<b>t</b>");
  });

  it("u355_a_checkpoint_stays_inside_the_measure", async () => {
    await mountThread(tree(), { checkpoints: [first] });
    await vi.waitFor(() => expect(document.querySelector("[data-checkpoint]")).not.toBeNull());

    expect(getComputedStyle(q("[data-checkpoints]")).maxWidth).toBe("var(--measure)");
    expect(getComputedStyle(q(".checkpoint-scroll")).overflowX).toBe("auto");
    expect(getComputedStyle(q(".checkpoint-text, .checkpoint-title")).color).not.toBe("var(--grey)");
    expect(getComputedStyle(q(".checkpoint-time")).color).toBe("var(--grey)");
  });

  it("u355_a_written_checkpoint_joins_the_top_by_event", async () => {
    const { app } = await mountThread(tree(), { messages: messages(), checkpoints: [first] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-checkpoint]")).toHaveLength(1));

    const needs = q("[data-needs]").innerHTML;
    const now = q(".thread-now").innerHTML;

    app.emit(event({ name: "checkpoint.written", data: second }));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-checkpoint]")).toHaveLength(2));

    expect(q("[data-checkpoint]").getAttribute("data-checkpoint")).toBe("2");
    expect(q("[data-needs]").innerHTML).toBe(needs);
    expect(q(".thread-now").innerHTML).toBe(now);
  });

  it("u355_a_reload_draws_the_same_checkpoints", async () => {
    await mountThread(tree(), { checkpoints: [first, second] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-checkpoint]")).toHaveLength(2));
    const html = q("[data-checkpoints]").textContent;

    cleanup();
    await mountThread(tree(), { checkpoints: [second, first] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-checkpoint]")).toHaveLength(2));

    expect(q("[data-checkpoints]").textContent).toBe(html);
  });

  it("u355_no_checkpoint_reads_no_checkpoint_yet", async () => {
    await mountThread(tree());

    expect(q("[data-checkpoints]").textContent).toBe("no checkpoint yet");
    expect(getComputedStyle(q("[data-checkpoints] .thread-none")).color).toBe("var(--grey)");
  });

  it("u355_the_full_log_is_a_closed_fold_holding_every_message", async () => {
    await mountThread(tree(), { messages: messages() });
    await vi.waitFor(() => expect(document.querySelector("[data-log] [data-message-body]")).not.toBeNull());

    const log = q<HTMLDetailsElement>("[data-log]");

    expect(log.tagName).toBe("DETAILS");
    expect(log.open).toBe(false);
    expect(log.querySelector("summary")!.textContent).toBe("full log 7");
    expect(getComputedStyle(log.querySelector(".thread-log-count")!).color).toBe("var(--grey)");
    expect([...log.querySelectorAll("[data-message-body]")].map((each) => each.getAttribute("data-message"))).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(q("[data-thread-input]").closest("[data-log]")).toBeNull();
  });

  it("u355_the_fold_keeps_each_message_status_and_sender_line", async () => {
    await mountThread(tree(), { messages: messages() });
    await vi.waitFor(() => expect(document.querySelector("[data-log] [data-message-body]")).not.toBeNull());

    const log = q("[data-log]");

    expect([...log.querySelectorAll("[data-message-status]")].map((each) => each.textContent)).toEqual(["held", "held", "dropped", "queued"]);
    expect(log.querySelectorAll("[data-message-sender]").length).toBeGreaterThan(0);
  });

  it("u355_a_message_by_event_raises_the_count_and_keeps_the_fold_closed", async () => {
    const { app } = await mountThread(tree(), { messages: [message(6, { from: DOOR, to: "a" })] });
    await vi.waitFor(() => expect(q("[data-log] summary").textContent).toBe("full log 1"));

    app.emit(sent(message(9, { from: USER, to: "r1" })));
    await vi.waitFor(() => expect(q("[data-log] summary").textContent).toBe("full log 2"));

    expect(q<HTMLDetailsElement>("[data-log]").open).toBe(false);
  });

  it("u355_u189_and_u195_hold_inside_the_open_fold", async () => {
    await mountThread(tree(), { messages: messages() });
    await vi.waitFor(() => expect(document.querySelector("[data-log] [data-message-body]")).not.toBeNull());
    fireEvent.click(q("[data-log] summary"));

    expect(document.querySelectorAll("[data-now]")).toHaveLength(2);
    expect(q("[data-log] [data-message-sender]").textContent).toMatch(/^lead \d\d:\d\d$/);
  });
});
