import { createSignal } from "solid-js";
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
    ["blocked", "barred", "grey"],
    ["working", "quarter", "accent"],
    ["idle", "ring", "grey"],
    ["done", "check", "grey"],
  ] as const)("u401_the_glyph_component_draws_%s_as_%s_in_%s", (kind, drawing, tone) => {
    const span = markOf(kind);

    expect([span?.dataset["drawing"], span?.dataset["tone"], span?.querySelectorAll("svg").length]).toEqual([drawing, tone, 1]);
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
    expect(new Set(kinds.map((kind) => markOf(kind)?.dataset["drawing"])).size).toBe(6);
  });

  it("u401_every_kind_has_its_ring_fill_drawing", () => {
    expect(kinds.map((kind) => markOf(kind)?.dataset["drawing"])).toEqual(["cross", "disc", "barred", "quarter", "ring", "check"]);
  });

  it("u401_the_six_glyphs_have_distinct_markup", () => {
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

    expect([span?.getAttribute("role"), span?.getAttribute("aria-label")]).toEqual(["img", "Working"]);
    expect(container.querySelector("svg")?.querySelector("animate, animateTransform")).toBeNull();
  });
});

describe("u3010c_m9", () => {
  it("u3010c_a_kind_change_keeps_one_accessible_glyph_and_drops_the_old_mark", async () => {
    const [kind, setKind] = createSignal<Kind>("idle");
    const { container } = render(() => <KindGlyph kind={kind()} />);

    setKind("working");
    expect(container.querySelectorAll("[role=img]")).toHaveLength(1);
    expect(container.querySelector("span")?.dataset["drawing"]).toBe("quarter");
    cleanup();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("u3010c_a_second_change_mid_fade_leaves_one_mark_of_the_latest_kind", async () => {
    const [kind, setKind] = createSignal<Kind>("idle");
    const { container } = render(() => <KindGlyph kind={kind()} />);

    setKind("working");
    setKind("error");
    await new Promise((done) => setTimeout(done, 300));
    expect([container.querySelectorAll("svg").length, container.querySelector("span")?.dataset["drawing"]]).toEqual([1, "cross"]);
  });
});

describe("u3010c_m9_first_change", () => {
  it("u3010c_the_first_change_after_mount_mounts_a_leaving_mark_that_clears", async () => {
    document.documentElement.style.setProperty("--duration-reduced", "150ms");
    const [kind, setKind] = createSignal<Kind>("error");
    const { container } = render(() => <KindGlyph kind={kind()} />);

    setKind("idle");
    await Promise.resolve();
    expect(container.querySelectorAll("svg").length).toBe(2);
    await new Promise((done) => setTimeout(done, 400));
    expect(container.querySelectorAll("svg").length).toBe(1);
  });
});
