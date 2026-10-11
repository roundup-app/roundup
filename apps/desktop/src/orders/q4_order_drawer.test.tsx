import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { mountApp, select } from "../decisions/decisionsFixture";
import { agent, clarifying, door } from "../testing/nodes";
import { orderLine } from "./orderText";

const limits = [
  "Change no file in the repo",
  "Keep it short: one small example of each feature",
];

const open = async (work: { kind: "work"; ask: string; limits: string[] }) => {
  await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", "working", "editing", { name: "alpha", order: 0, work }),
      agent("b", "working", "editing", {
        name: "beta",
        order: 1,
        work: clarifying("which build?"),
      }),
      door("r", "working", "editing", {
        name: "harbor",
        order: 2,
        work: clarifying("what is this Workstream for?"),
      }),
    ];
  });
  select("alpha");
  await waitFor(() =>
    expect(document.querySelector(".order-line")).not.toBeNull(),
  );
  fireEvent.click(document.querySelector(".order-line")!);

  return await screen.findByLabelText("full order of alpha");
};

describe("Q4: a Work order has visible parts", () => {
  it("q4_limits_are_a_heading_over_the_list_with_no_prefix", async () => {
    const drawer = await open({ kind: "work", ask: "Give a tour", limits });
    expect(drawer.textContent?.toLowerCase()).not.toContain("must not");
    const label = drawer.querySelector(".order-part-label")!;
    expect(label.textContent).toBe("limits");
    expect(drawer.querySelectorAll("h3")).toHaveLength(1);
    expect(
      drawer.querySelector(".order-ask")!.compareDocumentPosition(label) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      [...drawer.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(limits);
    const style = getComputedStyle(drawer);
    expect(style.textAlign).toBe("left");
    expect(style.fontFamily).toBe("var(--font-ui)");
  });

  it("q4_an_order_without_limits_has_no_label", async () => {
    const drawer = await open({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelector(".order-part-label")).toBeNull();
    expect(drawer.querySelector("ul")).toBeNull();
  });
});

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
      "clarifying: which?",
    );
    expect(line(3)).not.toContain("must not");
  });
});
