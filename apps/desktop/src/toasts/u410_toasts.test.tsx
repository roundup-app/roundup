import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent, USER } from "../testing/nodes";
import { AGENT, by, mountToasts, pad, status, todo } from "./toastFixture";

const tree = () => [agent("a", "working", "x", { name: "scout" }), agent("b", "working", "x", { name: "mason" })];

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();
};

const names = (cards: HTMLElement[]) => cards.map((card) => card.textContent?.trim());

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("u410 which events make a Toast", () => {
  it("u410_needs_you_makes_a_toast", async () => {
    const { app, toasts, sounds } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();

    expect(toasts()).toHaveLength(1);
    expect(names(toasts())).toEqual(["scout Needs you"]);
    expect(sounds).toHaveLength(1);
  });

  it("u410_error_makes_a_toast", async () => {
    const { app, toasts, sounds } = await mountToasts(tree());

    app.emit(status("b", "error"));
    await settle();

    expect(names(toasts())).toEqual(["mason Failed"]);
    expect(sounds).toHaveLength(1);
  });

  it("u410_an_agent_editing_the_users_todo_or_pad_makes_a_toast", async () => {
    const { app, toasts, sounds } = await mountToasts(tree(), { todos: [todo(7, USER, "ship it")], pads: [pad("plan", USER)] });

    app.emit(by(AGENT, { name: "todo.updated", data: todo(7, USER, "ship it") }));
    await settle();
    app.emit(by({ ...AGENT, id: "b" }, { name: "pad.changed", data: { name: "plan" } }));
    await settle();

    expect(names(toasts())).toEqual(['mason Changed Pad plan', 'scout Changed Todo "ship it"']);
    expect(sounds).toHaveLength(1);
  });

  it("u410_other_changes_make_none", async () => {
    const { app, toasts, sounds } = await mountToasts(tree(), { todos: [todo(7, AGENT)], pads: [pad("plan", AGENT)] });

    for (const kind of ["done", "idle", "working", "blocked"] as const) app.emit(status("a", kind));

    app.emit(by(AGENT, { name: "todo.updated", data: todo(7, AGENT) }));
    app.emit(by(AGENT, { name: "pad.changed", data: { name: "plan" } }));
    app.emit(by(USER, { name: "todo.updated", data: todo(8, USER) }));
    app.emit(status("a", "needs-you"));
    app.emit(status("a", "needs-you"));
    await settle();

    expect(toasts()).toHaveLength(1);
    expect(sounds).toHaveLength(1);
  });

  it("u410_loading_a_project_makes_none", async () => {
    const { app, toasts, sounds } = await mountToasts([agent("a", "needs-you", "x", { name: "scout" })]);

    app.emit(status("a", "needs-you"));
    await settle();

    expect(toasts()).toHaveLength(0);
    expect(sounds).toHaveLength(0);
  });
});

describe("u411 what a Toast shows and how it leaves", () => {
  it("u411_a_toast_shows_glyph_name_and_one_line", async () => {
    const { app, toasts, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();

    const toast = toasts()[0]!;

    expect(toast.tagName).toBe("BUTTON");
    expect(toast.querySelector(".glyph")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "scout: Needs you" })).toBe(toast);
    expect(view.container.querySelector("[role=status]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("u411_it_hides_after_five_seconds", async () => {
    const { app, toasts } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    await vi.advanceTimersByTimeAsync(4900);

    expect(toasts()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100 + 150);
    await settle();

    expect(toasts()).toHaveLength(0);
  });

  it("u411_hover_and_focus_keep_it", async () => {
    const { app, toasts } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    fireEvent.pointerEnter(toasts()[0]!);
    await vi.advanceTimersToNextFrame();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(toasts()).toHaveLength(1);

    fireEvent.focusIn(toasts()[0]!);
    fireEvent.pointerLeave(toasts()[0]!);
    await vi.advanceTimersToNextFrame();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(toasts()).toHaveLength(1);

    fireEvent.focusOut(toasts()[0]!);
    await vi.advanceTimersToNextFrame();
    await vi.advanceTimersByTimeAsync(4900);

    expect(toasts()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(400);
    await settle();

    expect(toasts()).toHaveLength(0);
  });

  it("u411_nothing_of_it_stays", async () => {
    const { app, view, toasts } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    fireEvent.keyDown(toasts()[0]!, { key: "Escape" });
    await vi.advanceTimersByTimeAsync(200);
    await settle();

    expect(toasts()).toHaveLength(0);
    expect(view.container.textContent).not.toContain("scout");
  });

  it("u411_no_bell_or_list_exists", async () => {
    const { app, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    await vi.advanceTimersByTimeAsync(6000);

    expect(view.container.querySelector("[aria-label*=bell i], [aria-label*=notification i], ul, ol")).toBeNull();
    expect(screen.queryByText(/scout/)).toBeNull();
  });
});

describe("u412 clicking a Toast opens what it names", () => {
  it("u412_clicking_selects_the_agent", async () => {
    const { app, toasts, connected, shown } = await mountToasts(tree());

    app.emit(status("b", "error"));
    await settle();
    fireEvent.click(toasts()[0]!);
    await settle();

    expect(connected.rail.selected()).toBe("b");
    expect(shown).toEqual(["/p"]);
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(toasts()).toHaveLength(0);
  });

  it("u412_clicking_opens_the_todo_or_pad_drawer", async () => {
    const { app, toasts, connected } = await mountToasts(tree(), { todos: [todo(7, USER)], pads: [pad("plan", USER)] });

    app.emit(by(AGENT, { name: "todo.updated", data: todo(7, USER) }));
    await settle();
    fireEvent.click(toasts()[0]!);
    await settle();

    expect(connected.drawer.content()).not.toBeNull();
    expect(await screen.findByRole("checkbox", { name: "Complete ship it" })).toBeTruthy();

    connected.drawer.close();
    app.emit(by(AGENT, { name: "pad.changed", data: { name: "plan" } }));
    await settle();
    fireEvent.click(toasts()[0]!);
    await settle();

    expect(connected.drawer.content()).not.toBeNull();
  });

  it("u412_a_gone_target_shows_the_failure_line", async () => {
    const { app, toasts, connected, view } = await mountToasts(tree(), { todos: [], pads: [] });

    app.emit(by(AGENT, { name: "todo.updated", data: todo(7, USER) }));
    await settle();
    fireEvent.click(toasts()[0]!);
    await settle();

    expect(connected.drawer.content()).toBeNull();
    expect(view.container.querySelector("[role=alert]")?.textContent).toContain("gone");

    await vi.advanceTimersByTimeAsync(5000);
    expect(view.container.querySelector("[role=alert]")?.textContent).toContain("gone");
  });
});

describe("u413 when roundup is not in front, and for the selected Agent", () => {
  it("u413_away_plays_the_sound_and_holds_the_toast", async () => {
    const { app, toasts, sounds, leaveWindow } = await mountToasts(tree());

    leaveWindow();
    app.emit(status("a", "needs-you"));
    await settle();

    expect(sounds).toHaveLength(1);
    expect(toasts()).toHaveLength(0);
  });

  it("u413_coming_back_shows_without_a_second_sound", async () => {
    const { app, toasts, sounds, leaveWindow, comeBack } = await mountToasts(tree());

    leaveWindow();
    app.emit(status("a", "needs-you"));
    app.emit(status("b", "error"));
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    comeBack();
    await settle();

    expect(names(toasts())).toEqual(["mason Failed", "scout Needs you"]);
    expect(sounds).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(6000);
    await settle();
    expect(toasts()).toHaveLength(0);
  });

  it("u468_a_visible_child_prompt_has_no_duplicate_toast", async () => {
    const { app, toasts, sounds } = await mountToasts(tree(), { selected: "a" });

    app.emit(status("a", "needs-you"));
    await settle();

    expect(toasts()).toHaveLength(0);
    expect(sounds).toHaveLength(0);

    app.emit(status("b", "needs-you"));
    await settle();

    expect(toasts()).toHaveLength(1);
  });
});

describe("u414 few Toasts, never in the way, quiet when idle", () => {
  const many = () => Array.from({ length: 10 }, (_, index) => agent(`n${index}`, "working", "x", { name: `agent ${index}` }));

  it("u414_ten_events_make_at_most_three_toasts", async () => {
    const { app, toasts } = await mountToasts(many());

    for (let index = 0; index < 10; index += 1) app.emit(status(`n${index}`, "needs-you"));
    await settle();

    expect(names(toasts())).toEqual(["agent 9 Needs you", "agent 8 Needs you", "And 8 more"]);
  });

  it("u414_repeats_replace_and_one_sound_per_second", async () => {
    const { app, toasts, sounds } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    app.emit(status("a", "error"));
    app.emit(status("a", "needs-you"));
    await settle();

    expect(toasts()).toHaveLength(1);
    expect(sounds).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    app.emit(status("a", "error"));
    await settle();

    expect(sounds).toHaveLength(2);
  });

  it("u414_escape_dismisses_and_the_card_leaves", async () => {
    const { app, toasts } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    fireEvent.keyDown(toasts()[0]!, { key: "Escape" });
    await vi.advanceTimersByTimeAsync(150);
    await settle();
    expect(toasts()).toHaveLength(0);
  });

  it("u414_idle_runs_nothing", async () => {
    const { toasts, app } = await mountToasts(tree());

    app.emit(status("a", "working"));
    await settle();

    expect(toasts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
