import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { createShelfFrame } from "./frame";

afterEach(() => localStorage.clear());

it("u3721_a_project_switch_keeps_the_state_unanimated", () => {
  const [path, setPath] = createSignal<string | null>("/one");
  const { frame, dispose } = createRoot(dispose => ({ frame: createShelfFrame(path, () => false, () => {}), dispose }));
  frame.toggleMaximise("key");
  frame.toggle("key");
  frame.toggle("key");
  flush();
  expect(frame.maximised()).toBe(true);
  setPath("/two");
  flush();
  expect(frame.maximised()).toBe(true);
  setPath("/one");
  flush();
  expect(frame.maximised()).toBe(true);
  expect(frame.animated()).toBe(false);
  frame.toggleMaximise("key");
  flush();
  expect(frame.maximised()).toBe(false);
  dispose();
});
