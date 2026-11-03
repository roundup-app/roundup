import { createSignal } from "solid-js";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { ReducedMotionContext } from "../app/reducedMotion";
import { KindGlyph } from "./KindGlyph";

const markOf = (kind: Kind) => {
  const { container } = render(() => <KindGlyph kind={kind} />);

  return container.querySelector("span");
};

afterEach(cleanup);

describe("u401 ring-fill", () => {
  const kinds: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

  it("u401_tones_and_ink_hold", () => {
    const inked = kinds.filter((kind) => markOf(kind)?.classList.contains("ink"));
    const tones = kinds.map((kind) => markOf(kind)?.dataset["tone"]);

    expect(inked).toEqual(["error", "needs-you"]);
    expect(tones).toEqual(["red", "amber", "grey", "accent", "grey", "grey"]);
  });

  it("u401_the_box_aria_and_stillness_hold", () => {
    const { container } = render(() => <KindGlyph kind="working" />);
    const span = container.querySelector("span");

    expect([span?.getAttribute("role"), span?.getAttribute("aria-label")]).toEqual(["img", "Working"]);
    expect(container.querySelector("svg")?.querySelector("animate, animateTransform")).toBeNull();
  });
});

describe("u3010c_m9", () => {
  it("u3010c_a_kind_change_keeps_one_accessible_glyph_and_drops_the_old_mark", async () => {
    const [kind, setKind] = createSignal<Kind>("idle");
    const { container } = render(() => <ReducedMotionContext.Provider value={() => false}><KindGlyph kind={kind()} /></ReducedMotionContext.Provider>);

    setKind("working");
    expect(container.querySelectorAll("[role=img]")).toHaveLength(1);
    expect(container.querySelector("span")?.dataset["drawing"]).toBe("quarter");
    cleanup();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("u3010c_a_second_change_mid_fade_leaves_one_mark_of_the_latest_kind", async () => {
    const [kind, setKind] = createSignal<Kind>("idle");
    const { container } = render(() => <ReducedMotionContext.Provider value={() => false}><KindGlyph kind={kind()} /></ReducedMotionContext.Provider>);

    setKind("working");
    setKind("error");
    await waitFor(() => expect(container.querySelectorAll("svg")).toHaveLength(1));
    expect([container.querySelectorAll("svg").length, container.querySelector("span")?.dataset["drawing"]]).toEqual([1, "cross"]);
  });
});

describe("u3010c_m9_first_change", () => {
  it("u3010c_the_first_change_after_mount_mounts_a_leaving_mark_that_clears", async () => {
    document.documentElement.style.setProperty("--duration-reduced", "150ms");
    const [kind, setKind] = createSignal<Kind>("error");
    const { container } = render(() => <ReducedMotionContext.Provider value={() => false}><KindGlyph kind={kind()} /></ReducedMotionContext.Provider>);

    setKind("idle");
    await Promise.resolve();
    expect(container.querySelectorAll("svg").length).toBe(2);
    await waitFor(() => expect(container.querySelectorAll("svg")).toHaveLength(1));
  });
});


it("u3010c_reduced_motion_settles_a_kind_change_and_an_in_progress_fade_immediately", async () => {
  document.documentElement.style.setProperty("--duration-reduced", "150ms");
  const [kind, setKind] = createSignal<Kind>("idle");
  const [reduced, setReduced] = createSignal(false);
  const { container } = render(() => <ReducedMotionContext.Provider value={reduced}><KindGlyph kind={kind()} /></ReducedMotionContext.Provider>);

  setKind("error");
  await waitFor(() => expect(container.querySelectorAll("svg")).toHaveLength(2));
  setReduced(true);
  expect(container.querySelectorAll("svg")).toHaveLength(1);
  setKind("working");
  expect(container.querySelectorAll("svg")).toHaveLength(1);
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Working");
});
