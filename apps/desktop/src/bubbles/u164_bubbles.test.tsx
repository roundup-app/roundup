import { nameOf } from "./places";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { event, info } from "../testing/nodes";
import { bubbleNames, bubbleCalls, mountBubbles, TERMINALS } from "./bubblesFixture";
import { clamped, MIN_HEIGHT, MIN_WIDTH } from "./places";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

const bubble = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.bubble[data-bubble="${id}"]`)!;

describe("u164 a bubble floats over the centre pane", () => {
  it("u164_a_bubble_floats_over_the_pane_and_adds_no_rail_row_or_switcher_entry", async () => {
    await mountBubbles("a");
    await waitFor(() => expect(bubbleNames()).toEqual(["cargo test", "zsh"]));

    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    expect(bubble("1").querySelector(".bubble-header")).not.toBeNull();
    expect(bubble("1").querySelector(".bubble-body")).not.toBeNull();
  });

  it("u164_a_refreshed_list_keeps_each_bubble_mounted", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => expect(bubbleNames()).toEqual(["cargo test", "zsh"]));

    const before = bubble("1");

    mounted.app.emit(event({ name: "terminal.changed" }));
    await waitFor(() => expect(mounted.app.calls.filter((call) => call.method === "terminal.list").length).toBeGreaterThan(1));

    expect(bubble("1")).toBe(before);
  });

  it("u164_opening_a_bubble_does_not_resize_the_pane", async () => {
    const mounted = await mountBubbles("w", []);
    const pane = document.querySelector(".pane")!;
    const before = pane.outerHTML;

    mounted.setListed([info("1", { owner: "w", title: "zsh" })]);
    mounted.app.emit(event({ name: "terminal.changed" }));
    await waitFor(() => expect(bubble("1")).not.toBeNull());

    expect(document.querySelector(".pane")!.outerHTML).toBe(before);
    expect(bubble("1").parentElement!.className).toBe("bubble-frame");
  });

  it("u164_the_header_drags_and_the_corner_resizes_and_stay_inside_the_pane", async () => {
    await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="1"]')!);
    const header = bubble("1").querySelector(".bubble-header")!;
    const x = parseFloat(bubble("1").style.left);

    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 100 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 140, clientY: 100 }));
    fireEvent(window, new MouseEvent("pointerup"));
    expect(parseFloat(bubble("1").style.left)).toBe(x + 40);

    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 100 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 100000, clientY: 100 }));
    fireEvent(window, new MouseEvent("pointerup"));
    expect(parseFloat(bubble("1").style.left) + parseFloat(bubble("1").style.width)).toBeLessThanOrEqual(800);

    const corner = document.querySelector('.bubble-zone[data-zone="se"][data-zone-of="1"]')!;

    fireEvent.pointerDown(corner, { button: 0, clientX: 0, clientY: 0 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: -100000, clientY: -100000 }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent(window, new MouseEvent("pointerup"));
    expect(parseFloat(bubble("1").style.width)).toBe(MIN_WIDTH);
    expect(parseFloat(bubble("1").style.height)).toBe(MIN_HEIGHT);
    expect(clamped({ x: -5, y: -5, w: 10000, h: 10000, min: false }, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, w: 800, h: 600, min: false });
  });

  it("u164_arrow_keys_on_the_header_move_and_shift_arrows_resize", async () => {
    await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="1"]')!);
    const header = bubble("1").querySelector<HTMLElement>(".bubble-header")!;
    const { left, width } = bubble("1").style;

    expect(header.tabIndex).toBe(0);
    header.focus();
    fireEvent.keyDown(header, { key: "ArrowRight" });
    expect(parseFloat(bubble("1").style.left)).toBe(parseFloat(left) + 16);
    fireEvent.keyDown(header, { key: "ArrowRight", shiftKey: true });
    expect(parseFloat(bubble("1").style.width)).toBe(parseFloat(width) + 16);
  });

  it("u164_a_resize_calls_terminal_resize_once_per_frame", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => bubble("1"));
    // SAFETY: terminal.resize params always carry an id.
    const sizes = () => bubbleCalls(mounted.app, "terminal.resize").filter((params) => (params as { id: string }).id === "1");

    expect(sizes()).toHaveLength(1);
  });

  it("u164_minimise_keeps_a_tab_and_restore_returns_the_same_place_and_size", async () => {
    await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="1"]')!);
    const style = bubble("1").getAttribute("style");

    fireEvent.click(bubble("1").querySelector('button[aria-label="Minimise"]')!);
    expect(bubble("1").hidden).toBe(true);

    const chip = document.querySelector<HTMLElement>('.terminal-tab[data-bubble="1"]')!;

    expect(chip.textContent).toContain("cargo test");
    fireEvent.click(chip);
    expect(bubble("1").hidden).toBe(false);
    expect(bubble("1").getAttribute("style")).toBe(style);
  });

  it("u523_opacity_is_removed_and_legacy_storage_is_ignored", async () => {
    window.localStorage.setItem("roundup:bubble-transparency:/p", "not json");
    await mountBubbles("a");
    await waitFor(() => bubble("1"));

    expect(screen.queryAllByRole("slider")).toEqual([]);
    expect(bubble("1").style.getPropertyValue("--bubble-ground")).toBe("");
    expect(window.localStorage.getItem("roundup:bubble-transparency:/p")).toBe("not json");
  });

  it("u164_a_new_run_bubble_never_moves_selection_or_focus", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => bubble("1"));
    const focused = document.activeElement;

    mounted.setListed([...TERMINALS, info("4", { owner: "a", title: "fresh run" })]);
    mounted.app.emit(event({ name: "terminal.changed" }));
    await waitFor(() => expect(bubbleNames()).toContain("fresh run"));

    expect(mounted.connected.rail.selected()).toBe("a");
    expect(document.activeElement).toBe(focused);
  });

  it("u164_an_exited_bubble_stays_readable_with_its_code_until_closed", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="1"]')!);

    expect(bubble("1").querySelector(".bubble-state")!.getAttribute("aria-label")).toBe("Running");
    mounted.app.emit(event({ name: "terminal.exited", data: { id: "1", code: 3 } }));
    await waitFor(() => expect(bubble("1").querySelector(".bubble-state")!.getAttribute("aria-label")).toBe("Exit 3"));
    expect(bubbleNames()).toContain("cargo test");
  });

  it("u164_close_calls_terminal_close_once_and_a_failure_keeps_the_bubble", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="1"]')!);
    const close = bubble("1").querySelector('button[aria-label="Close"]')!;

    fireEvent.click(close);
    await waitFor(() => expect(document.querySelector('.bubble[data-bubble="1"]')).toBeNull());
    expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{ id: "1" }]);

    mounted.app.handlers["terminal.close"] = () => {
      throw new Error("cannot close");
    };

    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="2"]')!);
    fireEvent.click(bubble("2").querySelector('button[aria-label="Close"]')!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("cannot close"));
    expect(bubble("2")).not.toBeNull();
  });

  it("u164_selection_shows_the_agents_runs_and_the_workstreams_terminals", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => expect(bubbleNames()).toEqual(["cargo test", "zsh"]));

    mounted.connected.rail.select("b");
    await waitFor(() => expect(bubbleNames()).toEqual(["zsh", "other run"]));
    mounted.connected.rail.select("other");
    await waitFor(() => expect(bubbleNames()).toEqual([]));
  });

  it("u164_a_hidden_bubble_returns_as_it_was", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="1"]')!);
    fireEvent.keyDown(bubble("1").querySelector(".bubble-header")!, { key: "ArrowDown" });
    const style = bubble("1").getAttribute("style");

    mounted.connected.rail.select("b");
    await waitFor(() => expect(document.querySelector('.bubble[data-bubble="1"]')).toBeNull());
    mounted.connected.rail.select("a");
    await waitFor(() => expect(bubble("1").getAttribute("style")).toBe(style));
  });

  it("u164_an_untitled_bubble_is_named_for_its_program", () => {
    expect(nameOf(info("5", { title: null, program: "fish" }))).toBe("fish");
  });

  it("u164_an_unmoved_hidden_bubble_returns_where_it_was", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => bubble("1"));
    const style = bubble("1").getAttribute("style");

    mounted.connected.rail.select("b");
    await waitFor(() => expect(document.querySelector('.bubble[data-bubble="1"]')).toBeNull());
    mounted.connected.rail.select("a");
    await waitFor(() => expect(bubble("1").getAttribute("style")).toBe(style));
  });

  it("u164_a_reload_restores_the_bubbles_from_the_list_and_snapshot", async () => {
    await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.click(document.querySelector('.terminal-tab[data-bubble="1"]')!);
    fireEvent.keyDown(bubble("1").querySelector(".bubble-header")!, { key: "ArrowDown" });
    const style = bubble("1").getAttribute("style");

    cleanup();
    const again = await mountBubbles("a");
    await waitFor(() => expect(bubble("1").getAttribute("style")).toBe(style));
    expect(bubbleCalls(again.app, "terminal.snapshot").length).toBeGreaterThan(0);
  });

  it("u164_daemon_exited_clears_places_and_makes_bubbles_read_only", async () => {
    const mounted = await mountBubbles("a");
    await waitFor(() => bubble("1"));
    fireEvent.keyDown(bubble("1").querySelector(".bubble-header")!, { key: "ArrowDown" });
    expect(window.sessionStorage.getItem("roundup:bubble-places:/p")).not.toBeNull();

    mounted.setExit({ code: 1 });
    await waitFor(() => expect(window.sessionStorage.getItem("roundup:bubble-places:/p")).toBeNull());
    mounted.emulators.made.get("1")!.type(new TextEncoder().encode("x"));
    // paneHarness.type calls screens.ts onInput synchronously; Daemon exit returns before flush.
    expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  });
});
