import { describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk, mostUrgent } from "./glyph";

describe("u4 ink", () => {
  it.each([
    ["needs-you", "disc", "amber"],
    ["error", "cross", "red"],
    ["blocked", "dashed", "grey"],
    ["working", "quarter", "accent"],
    ["idle", "ring", "grey"],
    ["done", "check", "grey"],
  ] as const)("u401_every_kind_has_its_ring_fill_drawing_%s", (kind, drawing, tone) => {
    expect(glyphOf(kind)).toEqual({ drawing, tone });
  });

  it("u4_only_needs_you_and_error_carry_ink", () => {
    const kinds: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

    expect(kinds.filter((kind) => hasInk(glyphOf(kind)))).toEqual(["error", "needs-you"]);
  });

  it.each([
    [["done", "idle", "working", "blocked", "needs-you", "error"], "error"],
    [["done", "idle", "needs-you"], "needs-you"],
    [["done", "working"], "working"],
  ] as const)("u4_the_most_urgent_of_%j_is_%s", (kinds, expected) => {
    expect(mostUrgent(kinds)).toBe(expected);
  });

  it("u4_no_kinds_have_no_most_urgent_kind", () => {
    expect(mostUrgent([])).toBeNull();
  });
});
