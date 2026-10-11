import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import { bundledRenderers, useRenderers } from "../pads/visualKinds";
import { agent, door, event, NOW, USER } from "../testing/nodes";
import { message, mountThread, sent } from "./threadFixture";

const tree = () => [door("r1", "working", "working", { name: "lead", work: { kind: "work", ask: "ship it", limits: [] } }), agent("a1", "working", "x", { parent: "r1", name: "ann" })];

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const first: Checkpoint = {
  id: 1,
  workstream: "r1",
  at: NOW,
  title: "Tests green",
  rewindable: false,
  blocks: [
    { kind: "rows", title: "Done", rows: [{ label: "build", value: "passes" }] },
    { kind: "table", head: ["agent", "state"], rows: [["ann", "working"]] },
  ],
};

const second: Checkpoint = {
  id: 2,
  workstream: "r1",
  at: NOW,
  title: "Plan",
  rewindable: false,
  blocks: [
    { kind: "diagram", mermaid: "graph TD; A-->B" },
    { kind: "text", text: "next: review" },
  ],
};

const cardIds = () => [...document.querySelectorAll<HTMLElement>("[data-checkpoint]")].map((each) => each.dataset.checkpoint);

const fixture = () => [
  message(1, { from: DOOR, to: "you", kind: "question", body: "which?" }),
  message(2, { from: DOOR, to: "you", kind: "note", body: "held note", status: "held", reason: "ask-first" }),
  message(3, { from: USER, to: "r1", body: "mine" }),
  message(4, { from: DOOR, to: "a1", body: "go", status: "held", reason: "takeover" }),
  message(5, { from: DOOR, to: "a1", body: "gone", status: "dropped", reason: "passed" }),
  message(6, { from: USER, to: "r1", body: "later", status: "pending" }),
];

const log = () => document.querySelector<HTMLDetailsElement>("[data-log]")!;

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
});

describe("u355 the Door's Thread reads as a timeline of checkpoints", () => {
  it("u355_the_thread_reads_status_needs_checkpoints_then_the_fold", async () => {
    await mountThread(tree(), { messages: fixture(), checkpoints: [first] });
    await vi.waitFor(() => expect(cardIds()).toEqual(["1"]));

    const order = ["[data-now]", "[data-needs]", "[data-checkpoints]", "[data-log]", "[data-thread-input]"].map((selector) => document.querySelector(selector)!);

    for (let at = 1; at < order.length; at++) expect(order[at - 1]!.compareDocumentPosition(order[at]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u355_what_needs_the_user_sits_above_the_checkpoints", async () => {
    await mountThread(tree(), { messages: fixture(), checkpoints: [first, second] });
    await vi.waitFor(() => expect(cardIds()).toHaveLength(2));

    const needs = document.querySelector<HTMLElement>("[data-needs]")!;

    // SAFETY: querySelectorAll over [data-need] yields HTML elements.
    expect([...needs.querySelectorAll("[data-need]")].map((each) => (each as HTMLElement).dataset.need)).toEqual(["1", "2"]);
    expect(needs.textContent).not.toContain("Tests green");
    expect(needs.querySelectorAll("button")).toHaveLength(1);
    expect(needs.compareDocumentPosition(document.querySelector("[data-checkpoints]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u355_nothing_waiting_draws_no_needs_region", async () => {
    await mountThread(tree(), { messages: [message(3, { from: USER, to: "r1" })], checkpoints: [first] });
    await vi.waitFor(() => expect(cardIds()).toHaveLength(1));

    expect(document.querySelector("[data-needs]")).toBeNull();
  });

  it("u355_each_block_kind_draws_in_the_doors_order", async () => {
    useRenderers({
      ...bundledRenderers,
      mermaid: async () => ({ initialize: () => {}, parse: async () => {}, render: async () => ({ svg: "<svg data-drawn></svg>" }) }),
    });
    await mountThread(tree(), { checkpoints: [second, first] });
    await vi.waitFor(() => expect(cardIds()).toEqual(["2", "1"]));

    const cards = [...document.querySelectorAll<HTMLElement>("[data-checkpoint]")];

    // SAFETY: querySelectorAll over [data-block] yields HTML elements.
    expect([...cards[1]!.querySelectorAll("[data-block]")].map((each) => (each as HTMLElement).dataset.block)).toEqual(["rows", "table"]);
    // SAFETY: querySelectorAll over [data-block] yields HTML elements.
    expect([...cards[0]!.querySelectorAll("[data-block]")].map((each) => (each as HTMLElement).dataset.block)).toEqual(["diagram", "text"]);
    expect(cards[1]!.querySelector(".thread-checkpoint-block-title")!.textContent).toBe("Done");
    expect([...cards[1]!.querySelectorAll("dt, dd")].map((each) => each.textContent)).toEqual(["build", "passes"]);
    expect([...cards[1]!.querySelectorAll("th")].map((each) => each.textContent)).toEqual(["agent", "state"]);
    expect(cards[0]!.querySelector("p.thread-checkpoint-text")!.textContent).toBe("next: review");
    await vi.waitFor(() => expect(cards[0]!.querySelector("svg[data-drawn]")).not.toBeNull());
    expect(cards[1]!.querySelector(".thread-checkpoint-title")!.textContent).toMatch(/Tests green\s+\d\d:\d\d/);
  });

  it("u355_a_failed_diagram_shows_its_source", async () => {
    useRenderers({
      ...bundledRenderers,
      mermaid: async () => ({ initialize: () => {}, parse: async () => { throw new Error("bad"); }, render: async () => ({ svg: "" }) }),
    });
    await mountThread(tree(), { checkpoints: [second] });
    await vi.waitFor(() => expect(document.querySelector("[data-block='diagram'] pre")).not.toBeNull());

    expect(document.querySelector("[data-block='diagram'] pre")!.textContent).toBe("graph TD; A-->B");
  });

  it("u355_checkpoint_text_is_never_html", async () => {
    const html: Checkpoint = { ...first, blocks: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }], title: "<b>t</b>" };

    await mountThread(tree(), { checkpoints: [html] });
    await vi.waitFor(() => expect(cardIds()).toHaveLength(1));

    expect(document.querySelector("[data-checkpoint] img, [data-checkpoint] b")).toBeNull();
    expect(document.querySelector(".thread-checkpoint-text")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("u355_a_checkpoint_stays_inside_the_measure", async () => {
    await mountThread(tree(), { checkpoints: [first] });
    await vi.waitFor(() => expect(cardIds()).toHaveLength(1));

    expect(getComputedStyle(document.querySelector(".thread-checkpoint")!).maxWidth).toBe("var(--measure)");
    expect(getComputedStyle(document.querySelector(".thread-checkpoint-scroll")!).overflowX).toBe("auto");
  });

  it("u355_a_written_checkpoint_joins_the_top_by_event", async () => {
    const { app } = await mountThread(tree(), { messages: fixture(), checkpoints: [first] });
    await vi.waitFor(() => expect(cardIds()).toEqual(["1"]));

    app.emit(event({ name: "checkpoint.written", data: second }));
    app.emit(event({ name: "checkpoint.written", data: { ...second, id: 3, workstream: "other" } }));
    await vi.waitFor(() => expect(cardIds()).toEqual(["2", "1"]));

    expect(document.querySelectorAll("[data-need]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-now]")).toHaveLength(2);
  });

  it("u355_a_reload_draws_the_same_checkpoints", async () => {
    await mountThread(tree(), { checkpoints: [second, first] });
    await vi.waitFor(() => expect(cardIds()).toEqual(["2", "1"]));
    cleanup();
    await mountThread(tree(), { checkpoints: [second, first] });
    await vi.waitFor(() => expect(cardIds()).toEqual(["2", "1"]));
  });

  it("u355_no_checkpoint_reads_no_checkpoint_yet", async () => {
    await mountThread(tree());
    await vi.waitFor(() => expect(document.querySelector("[data-checkpoints]")!.textContent).toBe("no checkpoint yet"));

    const note = document.querySelector(".thread-checkpoints-empty")!;

    expect(getComputedStyle(note).color).toBe("var(--grey)");
  });

  it("u355_the_full_log_is_a_closed_fold_holding_every_message", async () => {
    await mountThread(tree(), { messages: fixture(), fold: "closed" });
    await vi.waitFor(() => expect(document.querySelector(".thread-log-count")!.textContent).toBe("6"));

    expect(log().tagName).toBe("DETAILS");
    expect(log().open).toBe(false);
    expect(log().querySelector("summary")!.textContent).toMatch(/^full log\s+6$/);
    expect(getComputedStyle(log().querySelector(".thread-log-count")!).color).toBe("var(--grey)");
    expect(document.querySelector("[data-thread-input]")!.closest("[data-log]")).toBeNull();
    expect(document.querySelector(".thread-send")!.closest("[data-log]")).toBeNull();

    log().open = true;

    for (const body of ["which?", "held note", "mine", "go", "gone", "later"]) expect(log().textContent).toContain(body);
  });

  it("u355_the_fold_keeps_each_message_status_and_sender_line", async () => {
    await mountThread(tree(), { messages: fixture() });
    await vi.waitFor(() => expect(log().querySelectorAll("[data-message-sender]").length).toBeGreaterThan(0));

    const words = [...log().querySelectorAll("[data-message-status]")].map((each) => each.textContent);

    expect(words).toEqual(["waiting for approval", "waiting until the takeover ends", "not delivered: it was passed on", "queued"]);
    expect(log().querySelectorAll("[data-message]").length).toBe(6);
  });

  it("u355_a_message_by_event_raises_the_count_and_keeps_the_fold_closed", async () => {
    const { app } = await mountThread(tree(), { messages: fixture(), fold: "closed" });
    await vi.waitFor(() => expect(document.querySelector(".thread-log-count")!.textContent).toBe("6"));

    app.emit(sent(message(7, { from: USER, to: "r1", body: "new" })));
    await vi.waitFor(() => expect(document.querySelector(".thread-log-count")!.textContent).toBe("7"));

    expect(log().open).toBe(false);
  });

  it("u355_u189_and_u195_hold_inside_the_open_fold", async () => {
    await mountThread(tree(), { messages: fixture(), checkpoints: [first] });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-now]")).toHaveLength(2));

    expect(log().open).toBe(true);
    expect(log().querySelector("[data-message-sender]")!.textContent).toMatch(/lead\s+\d\d:\d\d/);
    expect(log().querySelectorAll("[data-now]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "answer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "answer" }));
    expect(document.querySelector("[data-answering]")).not.toBeNull();
  });
});
