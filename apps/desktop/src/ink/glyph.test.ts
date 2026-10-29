import { describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk } from "./glyph";

describe("u4 ink", () => {
  it.each([
    ["needs-you", "disc", "amber"],
    ["error", "cross", "red"],
    ["blocked", "barred", "grey"],
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
});
