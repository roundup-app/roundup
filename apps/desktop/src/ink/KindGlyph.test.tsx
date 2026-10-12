import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { KindGlyph } from "./KindGlyph";

const markOf = (kind: Kind) => {
  const { container } = render(() => <KindGlyph kind={kind} />);

  return container.querySelector("span");
};

afterEach(cleanup);

describe("u4 ink", () => {
  it.each([
    ["needs-you", "disc", "amber"],
    ["error", "cross", "red"],
    ["blocked", "dashed", "grey"],
    ["working", "quarter", "accent"],
    ["idle", "ring", "grey"],
    ["done", "check", "grey"],
  ] as const)("u401_the_glyph_component_draws_%s_as_%s_in_%s", (kind, shape, tone) => {
    const span = markOf(kind);

    expect([span?.dataset["shape"], span?.dataset["tone"], span?.querySelectorAll("svg").length]).toEqual([shape, tone, 1]);
  });

  it.each([
    ["needs-you", true],
    ["error", true],
    ["blocked", false],
    ["working", false],
    ["idle", false],
    ["done", false],
  ] as const)("u4_the_glyph_component_for_%s_carries_ink_%s", (kind, ink) => {
    expect(markOf(kind)?.classList.contains("ink")).toBe(ink);
  });
});

describe("u401 ring-fill", () => {
  const kinds: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

  it("u401_no_two_kinds_share_a_shape", () => {
    expect(new Set(kinds.map((kind) => markOf(kind)?.dataset["shape"])).size).toBe(6);
  });

  it("u401_every_kind_has_its_ring_fill_shape", () => {
    expect(kinds.map((kind) => markOf(kind)?.dataset["shape"])).toEqual(["cross", "disc", "dashed", "quarter", "ring", "check"]);
  });

  it("u401_the_six_glyphs_differ_in_greyscale", () => {
    const drawn = kinds.map((kind) => markOf(kind)?.querySelector("svg")?.innerHTML.replaceAll(/currentColor|var\(--ground\)/g, "c"));

    expect(new Set(drawn).size).toBe(6);
  });

  it("u401_tones_and_ink_hold", () => {
    const inked = kinds.filter((kind) => markOf(kind)?.classList.contains("ink"));
    const marks = kinds.map((kind) => markOf(kind)?.querySelector("svg path[stroke]")?.getAttribute("stroke"));

    expect(inked).toEqual(["error", "needs-you"]);
    expect(marks.filter((stroke) => stroke && stroke !== "var(--ground)" && stroke !== "none")).toEqual([]);
  });

  it("u401_the_box_aria_and_stillness_hold", () => {
    const { container } = render(() => <KindGlyph kind="working" />);
    const span = container.querySelector("span");

    expect([span?.getAttribute("role"), span?.getAttribute("aria-label")]).toEqual(["img", "working"]);
    expect(container.querySelector("svg")?.querySelector("animate, animateTransform")).toBeNull();
  });
});
