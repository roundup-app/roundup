import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import {afterEach, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";
import { Tip } from "./Tip";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("u2749b_focus_opens_without_a_pointer", async () => {
  render(() => <Tip text="Explain">{(trigger) => <span {...trigger()} tabIndex={0}>Owner</span>}</Tip>);
  fireEvent.keyDown(document, { key: "Tab" });
  screen.getByText("Owner").focus();
  expect((await screen.findByRole("tooltip")).textContent).toBe("Explain");
});

it.each([
  { DEV: true, MODE: "development", explicit: false },
  { DEV: true, MODE: "development", explicit: true },
  { DEV: false, MODE: "test", explicit: false },
  { DEV: false, MODE: "test", explicit: true },
])("u2749b_pointer_outside_anchor_throws %j", async (env) => {
  vi.stubEnv("DEV", env.DEV);
  vi.stubEnv("MODE", env.MODE);
  vi.useFakeTimers({ toFake: ["queueMicrotask", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  let anchor: HTMLSpanElement | undefined;
  render(() => <><span ref={anchor}>Explicit anchor</span><Tooltip.Root anchor={env.explicit ? () => anchor : undefined} openDelay={0}>
    <Tooltip.Trigger>Owner</Tooltip.Trigger><Tooltip.Positioner><Tooltip.Content>Explain</Tooltip.Content></Tooltip.Positioner>
  </Tooltip.Root></>);
  vi.spyOn(anchor!, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 16, 16));
  vi.spyOn(screen.getByRole("button"), "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 16, 16));
  fireEvent.pointerMove(screen.getByRole("button"), { pointerType: "mouse", clientX: 300, clientY: 300 });
  await Promise.resolve();
  expect(() => { vi.runAllTimers(); vi.runAllTicks(); }).toThrow("Tooltip anchor excludes its opening pointer");
});
