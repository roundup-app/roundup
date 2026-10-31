import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leaderKey } from "../keys/leaderFixture";
import { bubbleNames, bubbleCalls, bubbleChord, mountBubbles } from "./bubblesFixture";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

const focusBubble = (id: string): void => {
  fireEvent.click(document.querySelector(`.terminal-tab[data-bubble="${id}"]`)!);
  bubble(id).querySelector<HTMLElement>("button")?.focus();
};

const bubble = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.bubble[data-bubble="${id}"]`)!;

describe("u165 the keys for bubbles", () => {
  it("u165_cmd_t_opens_a_focused_bubble_or_says_to_select_a_workstream", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => expect(bubble("1")).not.toBeNull());

    expect(bubbleChord("t").defaultPrevented).toBe(true);
    await waitFor(() => expect(bubbleNames()).toContain("login"));
    expect(bubbleCalls(mounted.app, "terminal.open")).toMatchObject([{ workstream: "w" }]);
    await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("9"));
    expect(document.querySelector('[role="treeitem"]')).toBeNull();

    cleanup();
    const nothing = await mountBubbles(null);

    bubbleChord("t");
    await waitFor(() => expect(bubbleCalls(nothing.app, "terminal.open")).toMatchObject([{ workstream: "w" }]));
    expect(bubbleChord("t", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(bubbleChord("t", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("u165_holding_cmd_t_opens_one_bubble", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => expect(bubble("1")).not.toBeNull());

    bubbleChord("t");
    bubbleChord("t", { repeat: true });
    bubbleChord("t", { repeat: true });
    await waitFor(() => expect(bubbleNames()).toContain("login"));
    expect(bubbleCalls(mounted.app, "terminal.open")).toHaveLength(1);
  });

  it("u165_a_failed_open_shows_the_failure_line_and_opens_nothing", async () => {
    const mounted = await mountBubbles("a");

    mounted.app.handlers["terminal.open"] = () => {
      throw new Error("no shell");
    };

    await waitFor(() => expect(bubble("1")).not.toBeNull());
    bubbleChord("t");
    await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("no shell"));
    expect(bubbleNames()).not.toContain("login");
  });

  it("u165_no_plus_terminal_is_in_the_pinned_line_the_inside_line_or_any_menu", async () => {
    const { mountRail } = await import("../rail/railFixture");
    const { TREE } = await import("./bubblesFixture");

    await mountRail(TREE);
    expect([...document.querySelectorAll("button")].map((button) => button.textContent?.trim())).not.toContain("+ terminal");
    expect(document.body.textContent).not.toContain("terminal");
  });

  it("u165_leader_m_minimises_and_restores_the_focused_bubble", async () => {
    await mountBubbles("a");
    await waitFor(() => expect(bubble("1")).not.toBeNull());
    focusBubble("1");

    leaderKey("KeyM");
    expect(bubble("1").hidden).toBe(true);
    await waitFor(() => expect(document.activeElement?.classList.contains("terminal-tab")).toBe(true));
    leaderKey("KeyM");
    expect(bubble("1").hidden).toBe(false);
  });

  it("u165_leader_w_closes_with_one_call_and_returns_focus", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => expect(bubble("1")).not.toBeNull());
    const pane = document.querySelector<HTMLElement>(".pane-screen [tabindex]");

    pane?.focus();
    focusBubble("1");
    expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("1");
    leaderKey("KeyW");
    await answerQuestion(true);
    await waitFor(() => expect(document.querySelector('.bubble[data-bubble="1"]')).toBeNull());
    expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{ id: "1" }]);
    await waitFor(() => expect(document.activeElement).toBe(pane ?? document.body));
  });

  it("u165_leader_m_and_w_with_no_focused_bubble_do_nothing", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => expect(bubble("1")).not.toBeNull());
    document.querySelector<HTMLElement>(".pane-screen [tabindex]")?.focus();

    leaderKey("KeyM");
    leaderKey("KeyW");
    expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([]);
    expect(bubble("1")).not.toBeNull();
  });

  it("u165_other_keys_reach_the_terminal_and_help_lists_the_bubble_chord", async () => {
    const { CHORDS } = await import("../keys/chords");

    await mountBubbles("a");
    await waitFor(() => expect(bubble("1")).not.toBeNull());
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    bubble("1").dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(CHORDS.slice(0, 5).map((entry) => entry.keys)).toEqual(["⌘N", "⇧⌘N", "⌥⌘N", "⇧⌘M", "⌘T"]);
    fireEvent.keyDown(document.body, { key: "x" });
  });
});
