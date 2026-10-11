import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callsTo } from "../terminal/paneHarness";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread, sent, threadInput } from "./threadFixture";
import { event } from "../testing/nodes";

const tree = () => [door("workstream", "idle", "idle", { name: "lead" }), agent("a", "working", "x", { parent: "workstream", name: "ann" }), agent("b", "idle", "x", { parent: "workstream", name: "bob" })];

const bodies = () => [...document.querySelectorAll("[data-message-body]")].map((line) => line.textContent);

const ctrlO = (target: Element) => fireEvent.keyDown(target, { key: "o", code: "KeyO", ctrlKey: true });

afterEach(cleanup);

describe("u106 agent-to-agent Messages are folded under their sender", () => {
  it("u106_a_long_body_shows_its_first_60_characters_and_a_short_one_whole", async () => {
    const { connected } = await mountThread(tree(), {
      messages: [message(1, { body: "short body" }), message(2, { body: "x".repeat(80) })],
    });

    await vi.waitFor(() => expect(bodies()).toHaveLength(2));

    expect(bodies()).toEqual(["short body", `${"x".repeat(60)}…`]);
    expect(connected.rail.nodes).toHaveLength(3);
  });

  it("u106_a_body_is_cut_at_60_characters", async () => {
    await mountThread(tree(), { messages: [message(1, { body: `${"a".repeat(59)}bc` })] });

    await vi.waitFor(() => expect(bodies()[0]).toBe(`${"a".repeat(59)}b…`));
  });

  it("u106_ctrl_o_in_the_input_or_feed_expands_every_body_and_again_folds_them", async () => {
    const body = "line one\nline two that is longer than sixty characters ".repeat(2);
    await mountThread(tree(), { messages: [message(1, { body })] });
    await vi.waitFor(() => expect(bodies()).toHaveLength(1));

    ctrlO(threadInput());

    expect(bodies()[0]).toBe(body);

    ctrlO(screen.getByRole("log"));

    expect(bodies()[0]).toMatch(/…$/);
  });

  it("u106_a_message_to_the_user_is_not_folded", async () => {
    const { app } = await mountThread(tree());

    app.emit(sent(message(5, { to: "you", body: "z".repeat(90) })));
    app.emit(event({ name: "message.sent", data: message(6, { from: USER, to: "workstream", body: "q".repeat(90) }) }));

    await vi.waitFor(() => expect(bodies()).toHaveLength(2));

    expect(bodies()).toEqual(["z".repeat(90), "q".repeat(90)]);
  });

  it("u106_ctrl_o_in_the_pane_reaches_terminal_write_and_does_not_toggle", async () => {
    const { app, connected, emulators } = await mountThread(tree(), { messages: [message(1, { body: "w".repeat(70) })] });
    await vi.waitFor(() => expect(bodies()).toHaveLength(1));

    connected.rail.select("a");
    // U375: an Agent's pane takes keys only in a Takeover.
    await connected.takeover.begin("a");
    ctrlO(document.querySelector(".pane-screen [data-terminal]")!);
    emulators.get("t-a")?.type(Uint8Array.of(15));
    connected.rail.select("workstream");

    expect(bodies()[0]).toMatch(/…$/);
    await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: "Dw==" }]));
  });

  it("u106_the_chord_is_not_kept_in_storage", async () => {
    await mountThread(tree(), { messages: [message(1)] });
    ctrlO(threadInput());

    expect(JSON.stringify({ ...localStorage })).not.toMatch(/expanded|ctrl/i);
  });
});
