import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";
import { callsTo, mountPane } from "../terminal/paneHarness";
import { info, node } from "../testing/nodes";

let watchers: ((entries: unknown[]) => void)[] = [];

class FakeResizeObserver {
  constructor(callback: (entries: unknown[]) => void) {
    watchers.push(callback);
  }

  observe() {}

  unobserve() {}

  disconnect() {}
}

const widthIs = (width: number) => {
  for (const watcher of watchers) watcher([{ contentRect: { width } }]);
};

beforeEach(() => {
  watchers = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("u430 the Terminal and the input beside an open Drawer", () => {
  it("u430_terminal_gets_one_resize_per_slide", async () => {
    const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");
    widthIs(800);
    vi.advanceTimersToNextFrame();

    const before = callsTo(app, "terminal.resize").length;
    const emulator = emulators.get("t-a")!;

    emulator.size = { cols: 60, rows: 30 };

    for (let frame = 1; frame <= 11; frame += 1) {
      widthIs(800 - (300 * frame) / 11);
      vi.advanceTimersByTime(16);
    }

    expect(callsTo(app, "terminal.resize")).toHaveLength(before);

    vi.advanceTimersByTime(60);
    vi.advanceTimersToNextFrame();

    expect(callsTo(app, "terminal.resize").slice(before)).toEqual([{ id: "t-a", cols: 60, rows: 30 }]);

    emulator.size = { cols: 100, rows: 30 };

    for (let frame = 1; frame <= 11; frame += 1) {
      widthIs(500 + (300 * frame) / 11);
      vi.advanceTimersByTime(16);
    }

    vi.advanceTimersByTime(60);
    vi.advanceTimersToNextFrame();

    expect(callsTo(app, "terminal.resize").slice(before)).toEqual([
      { id: "t-a", cols: 60, rows: 30 },
      { id: "t-a", cols: 100, rows: 30 },
    ]);
  });
});

describe("u430 the centre's input beside an open Drawer", () => {
  const mount = () => {
    const drawer = createDrawer();

    render(() => (
      <>
        <input aria-label="composer" />
        <DrawerHost drawer={drawer} reducedMotion={() => true} />
      </>
    ));
    drawer.open(() => <p>pad body text</p>);

    // SAFETY: the label names the `input` rendered above.
    return { drawer, composer: screen.getByLabelText("composer") as HTMLInputElement };
  };

  it("u430_centre_input_leaves_the_drawer_open", () => {
    const { drawer, composer } = mount();

    composer.focus();
    fireEvent.mouseDown(composer);
    fireEvent.click(composer);
    fireEvent.keyDown(composer, { key: "a" });
    fireEvent.keyDown(composer, { key: "Escape" });

    expect(drawer.content()).not.toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("u430_drawer_text_selects_and_pastes_into_the_input", () => {
    const { composer } = mount();
    const text = screen.getByText("pad body text");
    const range = document.createRange();

    range.selectNodeContents(text);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    // ⌘C copies the Drawer's words; the input is then clicked and takes them.
    const copied = window.getSelection()!.toString();

    composer.focus();
    fireEvent.mouseDown(composer);

    expect(copied).toBe("pad body text");
    expect(getComputedStyle(text).userSelect).not.toBe("none");

    // SAFETY: jsdom has no ClipboardEvent; the test adds the one field a paste handler reads.
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };

    paste.clipboardData = { getData: () => copied };
    composer.dispatchEvent(paste);
    composer.setRangeText(copied, 0, 0, "end");

    expect(paste.defaultPrevented).toBe(false);
    expect(composer.value).toBe("pad body text");
  });
});
