import * as sourceToast from "@ui-sdk/solid/toast";
import * as compiledToast from "../../node_modules/@ui-sdk/solid/dist/toast.js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { u492Fixture } from "./u492Fixture";

const duration = 5000;

// A leaving card keeps one fallback timer until its exit settles.
const exitWindow = 1000;

const toastSelector = '[data-slot="toast"]';

const announcer = '[data-ui-sdk-announcer=""]';

// The region is a manual popover jsdom never opens, so role queries skip it.
const region = () => document.querySelector<HTMLElement>('[data-slot="toast-region"]')!;

// The library clears a card's first-frame style a timer after the next animation frame.
const frame = async () => {
  await vi.advanceTimersToNextFrame();
  await vi.advanceTimersByTimeAsync(1);
};

// jsdom lacks the animation and top-layer APIs the library calls; a leaving card runs one transition that never ends by itself.
beforeAll(() => {
  const exit = { finished: new Promise(() => undefined) };

  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value(this: Element) { return this.hasAttribute("data-ending-style") ? [exit] : []; } });
  Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value: () => undefined });
});

afterAll(() => {
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each([["Solid", sourceToast], ["JS", compiledToast]] as const)("u492_%s_published_entry", (_name, library) => {
  function mount() {
    vi.useFakeTimers();
    const dismissed = vi.fn();
    // Call through to the real observer; detect installation after disposal.
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const toaster = library.createToaster<string>({ duration });

    const mounted = render(() => u492Fixture(toaster, library));

    const create = () => toaster({ title: "Saved", duration, onDismiss: (details) => dismissed(details.reason) });

    return { ...mounted, toaster, create, dismissed, observe, disconnect };
  }

  async function expectIdle(probe: ReturnType<typeof mount>) {
    const calls = probe.dismissed.mock.calls.length;
    const observations = probe.observe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(exitWindow);
    expect(document.querySelector(toastSelector)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    // Observation window: disposed/empty actors must never publish or observe later.
    await vi.advanceTimersByTimeAsync(duration * 2);
    expect(probe.dismissed).toHaveBeenCalledTimes(calls);
    expect(probe.observe).toHaveBeenCalledTimes(observations);
    expect(document.querySelector(toastSelector)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  }

  it.each(["immediate", "settled", "hovered", "focused", "hovered-focused", "settled-hovered-focused", "exiting"] as const)(
    "u492_%s_disposal_cancels_library_work",
    async (state) => {
      const probe = mount();
      const id = probe.create();
      flush();
      const card = document.querySelector<HTMLElement>(toastSelector)!;

      if (state.includes("settled")) {
        await frame();
        expect(card.hasAttribute("data-starting-style")).toBe(false);
        expect(screen.getByText("Saved")).toBeDefined();
        expect(probe.observe).toHaveBeenCalled();
      }

      if (state.includes("hovered")) fireEvent.pointerEnter(region());

      if (state.includes("focused")) card.focus();

      if (state.includes("hovered") || state.includes("focused")) {
        await vi.advanceTimersByTimeAsync(0);
        expect(region().hasAttribute("data-expanded")).toBe(true);
      }

      if (state === "exiting") {
        probe.toaster.dismiss(id);
        await vi.advanceTimersByTimeAsync(0);
        expect(card.hasAttribute("data-ending-style")).toBe(true);
      }

      probe.unmount();
      expect(vi.getTimerCount()).toBe(state === "exiting" ? 1 : 0);
      expect(document.querySelector(toastSelector)).toBeNull();

      if (state.includes("settled")) expect(probe.disconnect).toHaveBeenCalled();
      await expectIdle(probe);
    },
  );

  it("u492_empty_mount_schedules_nothing", async () => {
    const probe = mount();
    await expectIdle(probe);
    probe.unmount();
    await expectIdle(probe);
  });

  it("u492_five_second_expiry_keeps_exit_then_leaves_no_work", async () => {
    const probe = mount();
    probe.create();
    flush();
    const card = document.querySelector<HTMLElement>(toastSelector)!;
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(card.hasAttribute("data-ending-style")).toBe(false);
    expect(probe.dismissed).not.toHaveBeenCalled();
    // Expiry must dispatch at the deadline, before the next animation frame.
    await vi.advanceTimersByTimeAsync(1);
    expect(probe.dismissed).toHaveBeenLastCalledWith("timeout");
    expect(probe.toaster.toasts()).toHaveLength(0);
    await frame();
    await expectIdle(probe);
  });

  it("u492_public_update_supports_caller_full_duration_restart", async () => {
    const probe = mount();
    const id = probe.create();
    await vi.advanceTimersByTimeAsync(2000);
    probe.toaster.update(id, { duration: Infinity });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(duration * 2);
    expect(probe.toaster.toasts()).toHaveLength(1);
    expect(probe.dismissed).not.toHaveBeenCalled();
    // Restart policy belongs to #2003. The existing API can reset the full duration.
    probe.toaster.update(id, { duration });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(probe.toaster.toasts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(probe.dismissed).toHaveBeenLastCalledWith("timeout");
    expect(probe.toaster.toasts()).toHaveLength(0);
    await frame();
    await expectIdle(probe);
  });

  it("u492_subsequent_cards_restore_announcements_then_return_to_idle", async () => {
    const probe = mount();

    for (const title of ["First result saved", "Second result saved"]) {
      const id = probe.toaster({ title, duration: Infinity, onDismiss: (details) => probe.dismissed(details.reason) });
      flush();
      await frame();
      const card = document.querySelector<HTMLElement>(toastSelector)!;
      expect(region().contains(card)).toBe(true);
      expect(document.getElementById(card.getAttribute("aria-labelledby")!)?.textContent).toBe(title);
      // The shared live region speaks each card once, without making the visible stack live.
      await vi.advanceTimersByTimeAsync(duration);
      expect(region().getAttribute("aria-live")).toBeNull();
      expect(document.querySelector(announcer)?.textContent).toContain(title);
      probe.toaster.dismiss(id);
      await frame();
      await expectIdle(probe);
    }
  });
});
