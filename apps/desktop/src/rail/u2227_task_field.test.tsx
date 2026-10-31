import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const SPAWNED = agent("fresh", "idle", "starting");

const chord = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });

const field = () => screen.getByLabelText<HTMLTextAreaElement>("Work");

const type = (text: string) => fireEvent.input(field(), { target: { value: text } });

describe("u2227 the task field", () => {
  it("u2227_the_field_is_a_textarea", async () => {
    await mountRail([workstream("g")]);
    chord();

    expect(field().tagName).toBe("TEXTAREA");
  });

  it("u2227_enter_starts_the_agent", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => SPAWNED;
    chord();
    type(" fix\nthe thing ");
    fireEvent.keyDown(field(), { key: "Enter" });

    await waitFor(() =>
      expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: "fix\nthe thing", parent: null, model: null, effort: null }]),
    );
  });

  it("u2227_shift_enter_adds_a_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    chord();
    type("a");

    const handled = fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });

    expect(handled).toBe(true);
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u2227_enter_during_composition_starts_nothing", async () => {
    const mounted = await mountRail([workstream("g")]);
    chord();
    type("あ");
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    await Promise.resolve();

    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u2227_escape_closes_the_field_and_the_next_open_restores_the_text", async () => {
    await mountRail([workstream("g")]);
    chord();
    type("keep me");
    fireEvent.keyDown(field(), { key: "Escape" });

    expect(screen.queryByLabelText("Work")).toBeNull();

    chord();
    await Promise.resolve();

    expect(field().value).toBe("keep me");
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(7);
  });

  it("u2227_the_draft_ends_when_emptied_or_after_a_successful_spawn", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => SPAWNED;
    chord();
    type("gone");
    type("");
    fireEvent.keyDown(field(), { key: "Escape" });
    chord();

    expect(field().value).toBe("");

    type("sent");
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByLabelText("Work")).toBeNull());
    await waitFor(() => {
      chord();
      expect(field().value).toBe("");
    });
  });

  it("u2227_a_task_starts_with_the_chord_the_text_and_enter", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => SPAWNED;
    chord();
    type("do it");
    fireEvent.keyDown(field(), { key: "Enter" });

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn").length).toBe(1));
  });
});
