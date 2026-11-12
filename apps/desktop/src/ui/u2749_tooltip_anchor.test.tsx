import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import {afterEach, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it.each([
  { DEV: true, VITEST: "" },
  { DEV: false, VITEST: "true" },
])("u2749b_pointer_outside_anchor_throws %j", async (env) => {
  vi.stubEnv("DEV", env.DEV);
  vi.stubEnv("VITEST", env.VITEST);
  vi.useFakeTimers({ toFake: ["queueMicrotask", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  render(() => <Tooltip.Root openDelay={0}>
    <Tooltip.Trigger>Owner</Tooltip.Trigger><Tooltip.Positioner><Tooltip.Content>Explain</Tooltip.Content></Tooltip.Positioner>
  </Tooltip.Root>);
  vi.spyOn(screen.getByRole("button"), "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 16, 16));
  fireEvent.pointerMove(screen.getByRole("button"), { pointerType: "mouse", clientX: 300, clientY: 300 });
  await Promise.resolve();
  expect(() => { vi.runAllTimers(); vi.runAllTicks(); }).toThrow("Tooltip anchor excludes its opening pointer");
});
