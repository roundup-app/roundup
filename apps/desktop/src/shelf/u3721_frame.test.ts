import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { createShelfFrame } from "./frame";

afterEach(() => localStorage.clear());

it("u3721_a_project_switch_keeps_the_state_unanimated", () => createRoot(dispose => {
  const [path, setPath] = createSignal<string | null>("/one");
  const frame = createShelfFrame(path, () => false, () => {});
  frame.toggleMaximise("key");
  frame.toggle("key");
  frame.toggle("key");
  expect(frame.maximised()).toBe(true);
  setPath("/two");
  expect(frame.maximised()).toBe(true);
  setPath("/one");
  expect(frame.maximised()).toBe(true);
  expect(frame.animated()).toBe(false);
  frame.toggleMaximise("key");
  expect(frame.maximised()).toBe(false);
  dispose();
}));
