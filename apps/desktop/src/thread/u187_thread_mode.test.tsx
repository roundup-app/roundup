import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonExit } from "../app/seam";
import { RpcError } from "../app/seam";
import { callsTo } from "../terminal/paneHarness";
import { agent, door } from "../testing/nodes";
import { message, mountThread } from "./threadFixture";

const tree = () => [door("workstream", "idle", "idle", { name: "lead" }), agent("a", "working", "x", { parent: "workstream", name: "ann" }), door("other", "idle", "idle", { name: "second" })];

const screenOf = () => document.querySelector<HTMLElement>(".pane-screen")!;

const feed = () => document.querySelector("[data-thread-input]") && document.querySelector('[role="log"]');

const composer = () => document.querySelector("[data-thread-input]");

const takeOver = () => screen.getByRole("button", { name: "take over" });

// SAFETY: the filter keeps `takeover.*` calls, whose params are `TakeoverParams`.
const takeoverCalls = (app: { calls: { method: string; params: unknown }[] }) =>
  app.calls.filter((call) => call.method.startsWith("takeover.")).map((call) => `${call.method} ${(call.params as { agent: string }).agent}`);

const alt = (digit: number) => fireEvent.keyDown(document.body, { key: "¡", code: `Digit${digit}`, altKey: true });

afterEach(cleanup);

describe("u187 a selected Workstream shows its Thread, not its Door's prompt", () => {
  it("u187_a_selected_workstream_shows_the_feed_and_no_door_terminal", async () => {
    await mountThread(tree(), { messages: [message(1, { from: { kind: "agent", id: "workstream", parent: null }, to: "you", kind: "note" })] });

    expect(feed()).not.toBeNull();
    expect(composer()).not.toBeNull();
    expect(screenOf().hidden).toBe(true);
    expect(screenOf().inert).toBe(true);
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u187_no_key_or_paste_reaches_the_doors_terminal_in_thread_mode", async () => {
    const { app } = await mountThread(tree());

    for (const target of [document.body, screenOf(), screenOf().querySelector("textarea") ?? screenOf()]) {
      fireEvent.keyDown(target, { key: "a", code: "KeyA" });
      fireEvent.paste(target);
    }

    expect(screenOf().contains(document.activeElement)).toBe(false);
    expect(callsTo(app, "terminal.write")).toEqual([]);
    expect(callsTo(app, "terminal.resize")).toEqual([]);
  });

  it("u187_an_agent_below_the_door_shows_its_terminal_and_the_composer", async () => {
    const { connected } = await mountThread(tree());

    connected.rail.select("a");

    expect(screenOf().hidden).toBe(false);
    expect(feed()).toBeNull();
    expect(composer()).not.toBeNull();
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u187_take_over_calls_begin_once_shows_the_pane_and_band_and_focuses_the_emulator", async () => {
    const { app } = await mountThread(tree());

    fireEvent.click(takeOver());

    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")?.textContent?.trim()).toBe("Takeover: typing goes straight to lead"));

    expect(takeoverCalls(app).slice(1)).toEqual(["takeover.begin workstream"]);
    expect(screenOf().hidden).toBe(false);
    expect(composer()).toBeNull();
    expect(feed()).toBeNull();
    expect(screen.getByRole("button", { name: "end takeover" }).tagName).toBe("BUTTON");
    expect(screenOf().contains(document.activeElement)).toBe(true);
  });

  it("u187_alt_digit_on_the_door_row_takes_over", async () => {
    const { app, connected } = await mountThread(tree());

    alt(1);

    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());

    expect(connected.rail.selected()).toBe("workstream");
    expect(takeoverCalls(app).slice(1)).toEqual(["takeover.begin workstream"]);
  });

  it("u187_a_conflict_stays_in_thread_mode_with_the_failure_line", async () => {
    const { app } = await mountThread(tree());

    app.handlers["takeover.begin"] = () => {
      throw new RpcError(-32000, "lead is already taken over");
    };

    fireEvent.click(takeOver());

    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toContain("lead is already taken over"));

    expect(screenOf().hidden).toBe(true);
    expect(composer()).not.toBeNull();
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u187_end_takeover_and_alt_0_call_end_once_and_focus_the_composer", async () => {
    const { app } = await mountThread(tree());

    fireEvent.click(takeOver());
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "end takeover" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "end takeover" }));
    await vi.waitFor(() => expect(composer()).not.toBeNull());

    expect(takeoverCalls(app).slice(1)).toEqual(["takeover.begin workstream", "takeover.end workstream"]);
    expect(document.activeElement).toBe(composer());
    expect(screenOf().hidden).toBe(true);

    fireEvent.click(takeOver());
    await vi.waitFor(() => expect(composer()).toBeNull());
    alt(0);
    await vi.waitFor(() => expect(composer()).not.toBeNull());

    expect(takeoverCalls(app).slice(3)).toEqual(["takeover.begin workstream", "takeover.end workstream"]);
    expect(document.activeElement).toBe(composer());
  });

  it("u187_selecting_another_row_ends_the_takeover_first", async () => {
    const { app, connected } = await mountThread(tree());

    fireEvent.click(takeOver());
    await vi.waitFor(() => expect(composer()).toBeNull());
    connected.rail.select("a");
    await vi.waitFor(() => expect(composer()).not.toBeNull());

    expect(takeoverCalls(app).slice(1)).toEqual(["takeover.begin workstream", "takeover.end workstream"]);
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u187_daemon_exited_clears_the_takeover", async () => {
    const [exit, setExit] = createSignal<DaemonExit | null>(null);

    await mountThread(tree(), { daemonExit: exit });
    fireEvent.click(takeOver());
    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());

    setExit({ code: 1 });

    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).toBeNull());

    expect(composer()).not.toBeNull();
  });

  it("u187_a_reload_opens_in_thread_mode", async () => {
    const { app, connected } = await mountThread(tree());

    // The Daemon may still hold a Takeover this webview cannot list; it is ended once per Door, and a CONFLICT shows nothing.
    expect(takeoverCalls(app)).toEqual(["takeover.end workstream"]);
    expect(screenOf().hidden).toBe(true);
    expect(composer()).not.toBeNull();

    connected.rail.select("other");
    connected.rail.select("workstream");

    await vi.waitFor(() => expect(takeoverCalls(app)).toEqual(["takeover.end workstream", "takeover.end other"]));
  });
});
