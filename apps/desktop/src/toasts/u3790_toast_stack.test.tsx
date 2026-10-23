import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import css from "../ui/Toast.css?raw";
import { agent, USER } from "../testing/nodes";
import { TOAST_AGENT as AGENT, by, mountToasts, status, toastTodo as todo } from "./toastFixture";

const tree = () => [agent("a", "working", "x", { name: "scout" }), agent("b", "working", "x", { name: "mason" }), agent("c", "working", "x", { name: "tiler" })];

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();
};


const actions = () => [...document.querySelectorAll<HTMLElement>(".app-toast-action")];

const region = () => screen.getByRole("region");

const cards = (view: { container: HTMLElement }) => [...view.container.querySelectorAll<HTMLElement>(".app-toast")];

const bar = (card: HTMLElement) => card.querySelector<HTMLElement>(".app-toast-bar")!;


const hover = (on: boolean) => fireEvent[on ? "mouseEnter" : "mouseLeave"](region());

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("u3790 every Toast has a time and shows it", () => {
  it("u3790_a_notice_hides_at_five_seconds", async () => {
    const { app, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    await vi.advanceTimersByTimeAsync(4900);
    expect(cards(view)[0]!.dataset.state).toBe("open");
    await vi.advanceTimersByTimeAsync(100);
    expect(cards(view)[0]!.dataset.state).toBe("closed");
  });

  it("u3790_a_failure_toast_hides_at_ten_seconds", async () => {
    const { app, view } = await mountToasts(tree(), { todos: [] });

    app.emit(by(AGENT, { name: "todo.updated", data: todo(7, USER) }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Changed Todo/ }));
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("gone");
    await vi.advanceTimersByTimeAsync(9900);
    expect(screen.queryByRole("alert")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(100 + 200);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container.querySelector(".app-toast")).toBeNull();
  });

  it("u3790_the_bar_drains_with_the_time_left", async () => {
    const { app, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    // The bar spans the whole time, so a paused timer and a paused bar stand at the same share.
    expect(bar(cards(view)[0]!).style.getPropertyValue("--toast-time")).toBe("5000ms");
    expect(bar(cards(view)[0]!).style.animationPlayState).toBe("running");
    expect(bar(cards(view)[0]!).getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("u3790_no_toast_outlives_its_time", async () => {
    const { app, view } = await mountToasts(tree(), { todos: [] });

    app.emit(status("a", "needs-you"));
    app.emit(by(AGENT, { name: "todo.updated", data: todo(7, USER) }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Changed Todo/ }));
    await settle();
    await vi.advanceTimersByTimeAsync(10_000 + 400);
    await settle();
    expect(view.container.querySelector(".app-toast")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("u3791 the time pauses and resumes", () => {
  const pausedAt = async (pause: () => void, resume: () => void) => {
    const { app, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    pause();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cards(view)[0]!.dataset.state).toBe("open");
    expect(cards(view)[0]!.dataset.paused).toBeDefined();
    expect(bar(cards(view)[0]!).style.animationPlayState).toBe("paused");
    resume();
    await vi.advanceTimersByTimeAsync(1900);
    expect(cards(view)[0]!.dataset.state).toBe("open");
    await vi.advanceTimersByTimeAsync(100);
    expect(cards(view)[0]!.dataset.state).toBe("closed");
  };

  it("u3791_hover_pauses_and_leaving_resumes_from_what_was_left", async () => {
    await pausedAt(() => hover(true), () => hover(false));
  });

  it("u3791_focus_in_the_stack_pauses_it", async () => {
    const button = () => actions()[0]!;

    await pausedAt(() => button().focus(), () => button().blur());
  });

  it("u3791_a_hidden_window_pauses_it", async () => {
    const visibility = (value: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    try {
      await pausedAt(() => visibility("hidden"), () => visibility("visible"));
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("u3791_a_paused_toast_runs_no_timer_or_animation", async () => {
    const { app, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    hover(true);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    expect(bar(cards(view)[0]!).style.animationPlayState).toBe("paused");
  });
});

describe("u3792 the cards stack and fan out", () => {
  const three = async () => {
    const mounted = await mountToasts(tree());

    for (const id of ["a", "b", "c"]) {
      mounted.app.emit(status(id, "needs-you"));
      await settle();
    }

    return mounted;
  };

  it("u3792_cards_behind_are_smaller_and_peek_out", async () => {
    const { view } = await three();
    const [front, middle, back] = cards(view);

    expect(front!.textContent).toContain("tiler");
    expect([front, middle, back].map((card) => card!.style.getPropertyValue("--index"))).toEqual(["0", "1", "2"]);
    expect(region().style.getPropertyValue("--gap")).toBe("8px");
    expect([front, middle, back].every((card) => card!.dataset.overlap !== undefined)).toBe(true);
  });

  it("u3792_hover_and_focus_fan_the_stack_into_a_list", async () => {
    const { view } = await three();

    hover(true);
    await settle();
    expect(cards(view).every((card) => card.dataset.stack !== undefined && card.dataset.overlap === undefined)).toBe(true);
    expect(cards(view).map((card) => card.textContent?.trim())).toEqual(["tiler Needs you", "mason Needs you", "scout Needs you"]);
    hover(false);
    await settle();

    actions()[0]!.focus();
    await settle();
    expect(cards(view).every((card) => card.dataset.stack !== undefined)).toBe(true);
  });

  it("u3792_leaving_folds_it_back", async () => {
    const { view } = await three();

    hover(true);
    await settle();
    hover(false);
    await settle();
    expect(cards(view).every((card) => card.dataset.overlap !== undefined)).toBe(true);
  });

  it("u3792_only_the_front_card_is_focusable_when_folded", async () => {
    await three();
    expect(actions().map((button) => button.tabIndex)).toEqual([0, -1, -1]);

    hover(true);
    await settle();
    expect(actions().map((button) => button.tabIndex)).toEqual([0, 0, 0]);
  });

  it("u3792_dismissing_a_card_closes_the_gap_without_folding", async () => {
    const { view } = await three();

    hover(true);
    await settle();
    fireEvent.keyDown(screen.getByRole("button", { name: "tiler: Needs you" }), { key: "Escape" });
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(cards(view).map((card) => card.style.getPropertyValue("--index"))).toEqual(["0", "1"]);
    expect(cards(view).every((card) => card.dataset.stack !== undefined)).toBe(true);
  });
});

describe("u3793 how the cards move", () => {
  it("u3793_a_new_toast_lifts_in_and_the_rest_move_back", async () => {
    const { app, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    app.emit(status("b", "needs-you"));
    await settle();

    const [front, behind] = cards(view);

    expect(front!.textContent).toContain("mason");
    expect(front!.dataset.mounted).toBeDefined();
    expect(behind!.style.getPropertyValue("--index")).toBe("1");
    expect(behind!.dataset.sibling).toBeDefined();
  });

  it("u3793_a_leaving_card_fades_and_sinks_while_the_rest_move_up", async () => {
    const { app, view } = await mountToasts(tree());

    app.emit(status("a", "needs-you"));
    await settle();
    app.emit(status("b", "needs-you"));
    await settle();
    fireEvent.keyDown(screen.getByRole("button", { name: "mason: Needs you" }), { key: "Escape" });
    await vi.advanceTimersByTimeAsync(0);
    expect(cards(view)[0]!.dataset.state).toBe("closed");
    await vi.advanceTimersByTimeAsync(400);
    expect(cards(view).map((card) => card.style.getPropertyValue("--index"))).toEqual(["0"]);
  });

  it("u3793_only_transform_and_opacity_animate", () => {
    const properties = [...css.matchAll(/transition:\s*([^;]+);/g)].flatMap((match) => match[1]!.split(",").map((part) => part.trim().split(/\s+/)[0])).filter((name) => name !== "none");

    expect(properties.length).toBeGreaterThan(0);
    expect(new Set(properties)).toEqual(new Set(["translate", "scale", "opacity"]));
  });

  it("u3793_reduced_motion_switches_at_once_and_the_bar_still_drains", () => {
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));

    expect(reduced).toContain("transition: none");
    expect(reduced).not.toContain("animation");
    expect(css).toContain("animation: app-toast-drain");
  });
});
