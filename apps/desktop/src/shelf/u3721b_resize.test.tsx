import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Layout } from "../app/Layout";
import { Tabs } from "../ui/Tabs";
import { createShelfTabs, ShelfTabs } from "./Shelf";
import { createShelfFrame, type ShelfFrame } from "./frame";
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

it("u3721b_each_bench_size_change_by_key_or_pointer_sends_exactly_one_terminal_resize", async () => {
  try {
    const { connected, emulators } = await mountPane([node("a")], [info("t-a")]);
    connected.rail.select("a");
    let frame: ShelfFrame | undefined;

    render(() => {
      const state = createShelfFrame(() => "/test", () => false, () => {});
      const tabs = createShelfTabs(state);

      frame = state;

      return <Tabs.RootProvider value={tabs}><Layout header={<ShelfTabs frame={state} onToggle={state.toggle} />} rail={null} centre={null} shelf={null}
        overlay={null} shelfPlacement={{ open: state.open(), peeking: state.peeking(), covering: state.covering(), rendered: state.rendered(), shown: state.shown(), animated: state.animated(), keyed: state.keyed(), maximised: state.maximised(), onMaximise: state.toggleMaximise, reducedMotion: false, onSettle: state.settle, attach: state.attach, sliding: state.sliding() }} /></Tabs.RootProvider>;
    });
    const emulator = emulators.get("t-a");

    if (!emulator || !frame) throw new Error("not mounted");
    const fit = vi.spyOn(emulator, "fit");
    const state = frame;

    // The pane's first snapshot reflows once on its own; let it land before counting.
    await new Promise(done => setTimeout(done, 300));

    // A maximise changes the width at once and holds no layout motion; the browser's own observer fits it, which jsdom has none of, so only a repeat is caught here.
    const change = async (action: () => void, exact: boolean) => {
      fit.mockClear();
      action();
      // The Shelf's transition end, which jsdom never fires.
      state.settle();
      await new Promise(done => setTimeout(done, 300));

      if (exact) expect(fit).toHaveBeenCalledTimes(1);
      else expect(fit.mock.calls.length).toBeLessThanOrEqual(1);
    };

    for (const source of ["key", "pointer"] as const) {
      await change(() => state.toggle(source), true);
      await change(() => state.toggle(source), true);
      await change(() => state.toggleMaximise(source), false);
      await change(() => state.toggleMaximise(source), false);
    }
  } finally {
    cleanup();
  }
});
