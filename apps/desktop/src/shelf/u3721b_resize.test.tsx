import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { DrawerHost } from "../drawer/DrawerHost";
import { mountPane } from "../terminal/paneHarness";
import { info, node } from "../testing/nodes";

afterEach(cleanup);

it("u3721b_each_size_change_sends_exactly_one_terminal_resize", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });

  try {
    const { connected, emulators } = await mountPane([node("a")], [info("t-a")]);
    connected.rail.select("a");
    render(() => <DrawerHost drawer={connected.drawer} reducedMotion={() => false} />);
    const emulator = emulators.get("t-a");

    if (!emulator) throw new Error("no emulator");
    const fit = vi.spyOn(emulator, "fit");

    connected.drawer.open(() => <p>detail</p>, "key");
    fit.mockClear();
    vi.advanceTimersByTime(1000);
    expect(fit).toHaveBeenCalledTimes(1);

    fit.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Close"), { key: "Escape" });
    vi.advanceTimersByTime(1000);
    expect(fit).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
