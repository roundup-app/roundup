import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { asking, card, decision, mountApp, select } from "../decisions/decisionsFixture";
import { runChecks } from "../testing/checks";
import { agent, door } from "../testing/nodes";

const long = "Change no file in the repo ".repeat(12).trim();

const work = { kind: "work" as const, ask: long, limits: [] };

const laidOut = (element: Element | null) => {
  expect(element).not.toBeNull();
  const style = getComputedStyle(element!);
  expect(style.textAlign).toBe("left");
  expect(style.fontFamily).toBe("var(--font-ui)");
};

const meetsD2 = () => {
  // the test container and portal roots are outside the app's stylesheet and hold no text of their own
  for (const root of document.body.children) root.setAttribute("style", "font-size: var(--text-body)");
  const checks = runChecks();
  expect(checks.D2.status, JSON.stringify(checks.D2)).toBe("pass");
};

describe("Q2, Q3: generated text is laid out as hold:Plain asks", () => {
  it("q2_order_line", async () => {
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() =>
      expect(document.querySelector(".order-line")).not.toBeNull(),
    );
    // jsdom's own `button { text-align: center }` beats the author rule, so the alignment is read from the rule itself.
    const rule = readFileSync(resolve(process.cwd(), "src/orders/styles.css"), "utf8").match(/\.order-line \{[^}]*\}/)![0];
    expect(rule).toMatch(/text-align:\s*left/);
    expect(
      getComputedStyle(document.querySelector(".order-line")!).fontFamily,
    ).toBe("var(--font-ui)");
  });

  it("q2_order_drawer", async () => {
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() =>
      expect(document.querySelector(".order-line")).not.toBeNull(),
    );
    fireEvent.click(document.querySelector(".order-line")!);
    const drawer = await screen.findByLabelText("Full order of alpha");
    laidOut(drawer);
    expect(drawer.textContent).toContain(long);
  });

  it("q2_decision_card", async () => {
    await mountApp([
      asking("d1", "a", "Which folder should I use?", ["src", "docs"]),
    ]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    laidOut(card()!.querySelector(".decision-question"));
  });

  it("q2_decision_args_keep_code_font", async () => {
    await mountApp([decision("d2", "a")]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    const args = card()!.querySelector(".decision-args");
    expect(args).not.toBeNull();
    expect(getComputedStyle(args!).fontFamily).not.toBe("var(--font-ui)");
  });

  it("q3_decision_card_meets_d2_d5", async () => {
    await mountApp([asking("d1", "a", "Which folder should I use?", ["src", "docs"])]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    // D5 needs painted layout: src/testing/u197_column.test.ts::q3_decision_card_meets_d2_d5_on_painted_layout.
    meetsD2();
  });

  it.each([1280])("q3_the_surfaces_wrap_and_meet_d2_d5 at %i", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    window.dispatchEvent(new Event("resize"));
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
    fireEvent.click(document.querySelector(".order-line")!);
    const drawer = await screen.findByLabelText("Full order of alpha");
    // the long limit wraps: the Drawer neither scrolls sideways nor holds a line that cannot break
    expect(getComputedStyle(drawer).overflowX).not.toBe("scroll");

    for (const part of drawer.querySelectorAll(".order-title, .order-ask")) {
      expect(getComputedStyle(part).overflowWrap).toBe("anywhere");
      expect(getComputedStyle(part).whiteSpace).not.toBe("nowrap");
    }

    // the test container and portal roots are outside the app's stylesheet and hold no text of their own
    for (const root of document.body.children) root.setAttribute("style", "font-size: var(--text-body)");

    // D5 needs painted layout: src/testing/u197_column.test.ts::q3_long_drawer_wraps_and_meets_d2_d5_on_painted_layout.
    const checks = runChecks();
    expect(checks.D2.status, JSON.stringify(checks.D2)).toBe("pass");
  });
});
