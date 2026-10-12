import { describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { elapsed } from "./elapsed";
import { glyphOf, hasInk, mostUrgent } from "./glyph";

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

describe("u4 ink", () => {
  it.each([
    ["needs-you", "disc", "amber"],
    ["error", "cross", "red"],
    ["blocked", "dashed", "grey"],
    ["working", "quarter", "accent"],
    ["idle", "ring", "grey"],
    ["done", "check", "grey"],
  ] as const)("u401_every_kind_has_its_ring_fill_%s", (kind, fill, tone) => {
    expect(glyphOf(kind)).toEqual({ fill, tone });
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

  it.each([
    [0, "just now"],
    [59_999, "just now"],
    [MINUTE, "1m"],
    [4 * MINUTE, "4m"],
    [HOUR - 1, "59m"],
    [HOUR, "1h"],
    [2 * HOUR + 30 * MINUTE, "2h"],
    [DAY, "1d"],
    [3 * DAY + HOUR, "3d"],
  ])("u4_elapsed_%i_ms_reads_%s", (age, text) => {
    const clock = () => 1_000_000_000_000;

    expect(elapsed(clock() - age, clock())).toBe(text);
  });

  it("u4_a_since_in_the_future_reads_just_now", () => {
    expect(elapsed(5000, 1000)).toBe("just now");
  });
});
