import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
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
  // A zero delay opens inside the event dispatch, where jsdom reports the throw as uncaught; one tick leaves it to the timer run below.
  render(() => <Tooltip.Root delay={1}>
    <Tooltip.Trigger>Owner</Tooltip.Trigger><Tooltip.Content>Explain</Tooltip.Content>
  </Tooltip.Root>);
  flush();
  vi.spyOn(screen.getByRole("button"), "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 16, 16));
  fireEvent.pointerEnter(screen.getByRole("button"), { pointerType: "mouse", clientX: 300, clientY: 300 });
  await Promise.resolve();
  expect(() => { vi.runAllTimers(); vi.runAllTicks(); }).toThrow("Tooltip anchor excludes its opening pointer");
});
