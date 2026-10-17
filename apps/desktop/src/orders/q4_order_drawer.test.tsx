import { describe, expect, it } from "vitest";
import { orderLine } from "./orderText";

describe("Q5: the Rail's one-line order says it in words", () => {
  it("q5_the_four_forms", () => {
    const line = (n: number) =>
      orderLine({
        kind: "work",
        ask: "Give a tour",
        limits: Array(n).fill("x"),
      });

    expect(line(0)).toBe("Give a tour · no limits");
    expect(line(1)).toBe("Give a tour · 1 limit");
    expect(line(3)).toBe("Give a tour · 3 limits");
    expect(orderLine({ kind: "clarification", question: "which?" })).toBe(
      "Clarifying: which?",
    );
    expect(line(3)).not.toContain("must not");
  });
});
