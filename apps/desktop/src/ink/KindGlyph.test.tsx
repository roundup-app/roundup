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
  ] as const)("u401_the_glyph_component_draws_%s_as_%s_in_%s", (kind, fill, tone) => {
    const span = markOf(kind);

    expect([span?.dataset["fill"], span?.dataset["tone"], span?.querySelectorAll("svg").length]).toEqual([fill, tone, 1]);
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

  it("u401_no_two_kinds_share_a_drawing", () => {
    expect(new Set(kinds.map((kind) => markOf(kind)?.dataset["fill"])).size).toBe(6);
  });

  it("u401_the_six_glyphs_differ_in_greyscale", () => {
    const silhouette = (kind: Kind) => {
      const svg = markOf(kind)?.querySelector("svg");
      const ring = svg?.querySelector("circle");

      return [svg?.getAttribute("fill"), ring?.getAttribute("stroke-dasharray"), [...(svg?.querySelectorAll("path, circle") ?? [])].map((part) => part.getAttribute("d") ?? part.getAttribute("r") ?? "")].join("|");
    };

    expect(new Set(kinds.map(silhouette)).size).toBe(6);
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
