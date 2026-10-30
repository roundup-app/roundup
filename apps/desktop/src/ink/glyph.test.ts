import { describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk } from "./glyph";

describe("u4 ink", () => {
  it("u4_only_needs_you_and_error_carry_ink", () => {
    const kinds: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

    expect(kinds.filter((kind) => hasInk(glyphOf(kind)))).toEqual(["error", "needs-you"]);
  });
});
