import { readFileSync } from "node:fs";
import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createShelfFrame } from "./frame";
import { createMaximiseSlide } from "../ui/slideLifetime";

afterEach(() => localStorage.clear());

it("u3721b_each_size_change_starts_one_transform_motion_and_no_width_motion", () => {
  for (const file of ["../styles.css", "./styles.css"]) {
    const transitions = readFileSync(new URL(file, import.meta.url), "utf8").match(/transition[^;{}]*;/g) ?? [];

    for (const declaration of transitions) expect(declaration, declaration).not.toMatch(/\b(width|grid-template-columns)\b/);
  }

  createRoot(dispose => {
    const [reduced, setReduced] = createSignal(false);
    const frame = createShelfFrame(() => "/one", reduced, () => {});

    for (const source of ["key", "pointer"] as const) {
      frame.toggle(source);
      expect([frame.animated(), frame.keyed()]).toEqual([true, source === "key"]);
      frame.toggle(source);
      frame.toggleMaximise(source);
      expect([frame.animated(), frame.keyed()]).toEqual([true, source === "key"]);
    }

    setReduced(true);
    frame.toggle("key");
    expect(frame.animated()).toBe(false);
    dispose();
  });
});

const panel = (widths: number[]) => {
  const host = document.createElement("div");
  const animate = vi.fn((_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn(), finished: new Promise<void>(() => {}) }));

  Object.assign(host, { animate });
  host.getBoundingClientRect = () => DOMRect.fromRect({ width: widths.shift() ?? 0 });
  host.style.setProperty("--duration-key", "150ms");
  host.style.setProperty("--duration-drawer", "250ms");
  document.body.append(host);

  return { host, animate };
};

it("u3721b_maximise_and_restore_move_by_key_and_by_pointer", () => createRoot(dispose => {
  const grow = panel([600]);
  const slide = createMaximiseSlide(() => grow.host, () => true);

  slide.start(200, true);
  const [keyframes = [], options] = grow.animate.mock.calls[0] ?? [];
  expect(keyframes.map(frame => Object.keys(frame))).toEqual([["clipPath"], ["clipPath"]]);
  expect(options?.duration).toBe(150);
  expect(grow.host.style.minWidth).toBe("");

  const shrink = panel([200]);
  const restore = createMaximiseSlide(() => shrink.host, () => true);

  restore.start(600, false);
  expect(shrink.animate.mock.calls[0]?.[1].duration).toBe(250);
  expect(shrink.host.style.minWidth).toBe("600px");
  dispose();
}));

it("u3721b_a_press_during_a_motion_leaves_one_running_motion", () => createRoot(dispose => {
  const { host, animate } = panel([600, 200]);
  const slide = createMaximiseSlide(() => host, () => true);
  const cancels: ReturnType<typeof vi.fn>[] = [];

  animate.mockImplementation(() => {
    const cancel = vi.fn();
    cancels.push(cancel);

    return { cancel, finished: new Promise<void>(() => {}) };
  });
  slide.start(200, true);
  slide.start(600, true);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancels[0]).toHaveBeenCalledTimes(1);
  expect(cancels[1]).not.toHaveBeenCalled();
  dispose();
}));

it("u3721b_closing_a_full_bench_slides_it_out_whole_then_restores_its_width", () => {
  let dispose = () => {};

  const frame = createRoot(done => {
    dispose = done;

    return createShelfFrame(() => "/two", () => false, () => {});
  });

  frame.toggleMaximise("key");
  frame.toggle("key");
  frame.unmaximise();
  expect(frame.maximised()).toBe(true);
  frame.settle();
  expect(frame.maximised()).toBe(false);
  dispose();
});
