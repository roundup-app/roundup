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
    ["needs-you", "disc-bang", "amber"],
    ["error", "square-x", "red"],
    ["blocked", "bars", "grey"],
    ["working", "arc", "accent"],
    ["idle", "dot", "grey"],
    ["done", "check", "grey"],
  ] as const)("u396_every_kind_has_its_own_shape_the_glyph_component_draws_%s_as_%s_in_%s", (kind, mark, tone) => {
    const span = markOf(kind);

    expect([span?.dataset["form"] === mark && span?.querySelectorAll("svg").length === 1, span?.dataset["tone"]]).toEqual([true, tone]);
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

describe("u396 aria", () => {
  it("u396_aria_label_and_decorative_are_kept", () => {
    const { container } = render(() => (
      <>
        <KindGlyph kind="done" />
        <KindGlyph kind="done" decorative />
      </>
    ));

    const [named, hidden] = [...container.querySelectorAll("span.glyph")];

    expect([named?.getAttribute("role"), named?.getAttribute("aria-label"), hidden?.getAttribute("aria-hidden"), hidden?.getAttribute("role"), hidden?.getAttribute("aria-label")]).toEqual(["img", "done", "true", null, null]);
  });

  it("u396_no_two_kinds_share_a_shape", () => {
    const kinds: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

    expect(new Set(kinds.map((kind) => markOf(kind)?.dataset["form"])).size).toBe(6);
    cleanup();
  });
});
