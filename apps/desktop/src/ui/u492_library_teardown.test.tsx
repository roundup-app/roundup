import * as sourceToast from "@ark-ui/solid/toast";
import * as compiledToast from "../../node_modules/@ark-ui/solid/dist/components/toast/index.js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { u492Fixture } from "./u492Fixture";

const duration = 5000;

const removeDelay = 150;

const toastSelector = '[data-scope="toast"]';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each([["Solid", sourceToast], ["JS", compiledToast]] as const)("u492_%s_published_entry", (_name, library) => {
function mount() {
  vi.useFakeTimers();
  const status = vi.fn();
  // Call through to the real observer; detect installation after disposal.
  const observe = vi.spyOn(MutationObserver.prototype, "observe");
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  const toaster = library.createToaster({ placement: "bottom-end", removeDelay });

  const mounted = render(() => u492Fixture(toaster, library));

  const create = () => toaster.create({ title: "Saved", duration, onStatusChange: status });

  return { ...mounted, toaster, create, status, observe, disconnect };
}

async function expectIdle(probe: ReturnType<typeof mount>) {
  const calls = probe.status.mock.calls.length;
  const observations = probe.observe.mock.calls.length;
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector(toastSelector)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  // Observation window: disposed/empty actors must never publish or observe later.
  await vi.advanceTimersByTimeAsync(duration * 2);
  expect(probe.status).toHaveBeenCalledTimes(calls);
  expect(probe.observe).toHaveBeenCalledTimes(observations);
  expect(document.querySelector(toastSelector)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
}

it.each(["immediate", "settled", "hovered", "focused", "hovered-focused", "settled-hovered-focused", "exiting"] as const)(
  "u492_%s_disposal_cancels_library_work",
  async (state) => {
    const probe = mount();
    const id = probe.create();
    const card = screen.getByRole("status");

    if (state.includes("settled")) {
      // Zag's mount/height effects each schedule one RAF; let both run.
      await vi.advanceTimersToNextFrame();
      expect(card.hasAttribute("data-mounted")).toBe(true);
      expect(screen.getByText("Saved")).toBeDefined();
      expect(probe.observe).toHaveBeenCalled();
    }

    if (state.includes("hovered")) fireEvent.mouseMove(screen.getByRole("region"));

    if (state.includes("focused")) card.focus();

    if (state.includes("hovered") || state.includes("focused")) {
      await vi.advanceTimersByTimeAsync(0);
      expect(card.hasAttribute("data-paused")).toBe(true);
    }

    if (state === "exiting") {
      probe.toaster.dismiss(id);
      await vi.advanceTimersByTimeAsync(0);
      expect(card.dataset.state).toBe("closed");
    }

    probe.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('[data-scope="toast"]')).toBeNull();

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
  const card = screen.getByRole("status");
  await vi.advanceTimersByTimeAsync(duration - 1);
  expect(card.dataset.state).toBe("open");
  // Expiry must dispatch at the deadline, before the next animation frame.
  await vi.advanceTimersByTimeAsync(1);
  expect(card.dataset.state).toBe("closed");
  expect(probe.status).toHaveBeenLastCalledWith({ status: "dismissing", src: "timer" });
  await vi.advanceTimersByTimeAsync(removeDelay - 1);
  expect(screen.getByText("Saved")).toBeDefined();
  await vi.advanceTimersToNextFrame();
  expect(probe.status).toHaveBeenLastCalledWith({ status: "unmounted" });
  await expectIdle(probe);
});

it("u492_public_update_supports_caller_full_duration_restart", async () => {
  const probe = mount();
  const id = probe.create();
  const card = screen.getByRole("status");
  await vi.advanceTimersByTimeAsync(2000);
  probe.toaster.update(id, { duration: Infinity });
  await vi.advanceTimersByTimeAsync(0);
  expect(card.hasAttribute("data-paused")).toBe(true);
  await vi.advanceTimersByTimeAsync(duration * 2);
  expect(card.dataset.state).toBe("open");
  // Restart policy belongs to #2003. The existing API can reset the full duration.
  probe.toaster.update(id, { duration });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame(); // visible:updating's waitForNextTick.
  expect(card.hasAttribute("data-paused")).toBe(false);
  await vi.advanceTimersByTimeAsync(duration - 1);
  expect(card.dataset.state).toBe("open");
  await vi.advanceTimersByTimeAsync(1);
  expect(card.dataset.state).toBe("closed");
  expect(probe.status).toHaveBeenLastCalledWith({ status: "dismissing", src: "timer" });
  await vi.advanceTimersByTimeAsync(removeDelay);
  await vi.advanceTimersToNextFrame();
  await expectIdle(probe);
});


it("u492_subsequent_cards_restore_announcements_then_return_to_idle", async () => {
  const probe = mount();

  for (const title of ["First result saved", "Second result saved"]) {
    const id = probe.toaster.create({ title, duration: Infinity, onStatusChange: probe.status });
    const region = screen.getByRole("region");
    expect(region.textContent).toBe("");
    await vi.advanceTimersToNextFrame();
    const card = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.contains(card)).toBe(true);
    expect(document.getElementById(card.getAttribute("aria-labelledby")!)?.textContent).toBe(title);
    probe.toaster.dismiss(id);
    await vi.advanceTimersByTimeAsync(removeDelay - 1);
    expect(screen.getByText(title)).toBeDefined();
    await vi.advanceTimersToNextFrame();
    await expectIdle(probe);
  }
});

});
