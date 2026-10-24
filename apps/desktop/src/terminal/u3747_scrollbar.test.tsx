import { cleanup } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { showScrollbars } from "../scrollHover";
import { callsTo, mountPane } from "./paneHarness";
import { info, node } from "../testing/nodes";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("u3747_showing_the_bar_over_a_terminal_sends_no_resize", async () => {
  const { app, connected } = await mountPane([node("a")], [info("t-a")]);

  connected.rail.select("a");

  const shown = callsTo(app, "terminal.resize").length;
  const host = document.querySelector<HTMLElement>(".xterm") ?? document.body;

  showScrollbars(host);
  vi.advanceTimersByTime(300);
  vi.advanceTimersToNextFrame();
  vi.runAllTimers();
  vi.advanceTimersToNextFrame();

  expect(shown).toBe(1);
  expect(callsTo(app, "terminal.resize")).toHaveLength(shown);
});
