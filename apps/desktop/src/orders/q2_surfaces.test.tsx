import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { asking, card, mountApp, select } from "../decisions/decisionsFixture";
import { agent, door } from "../testing/nodes";
import { message, mountThread } from "../thread/threadFixture";

const long = "Change no file in the repo ".repeat(12).trim();

const work = { kind: "work" as const, ask: "Give a tour", limits: [long] };

const laidOut = (element: Element | null) => {
  expect(element).not.toBeNull();
  const style = getComputedStyle(element!);
  expect(style.textAlign).toBe("left");
  expect(style.fontFamily).toBe("var(--font-ui)");
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
    // jsdom's own `button { text-align: center }` beats the author rule `.order-line { text-align: left }`, so only the font is read.
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
    const drawer = await screen.findByLabelText("full order of alpha");
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

  it("q2_thread_message", async () => {
    await mountThread([door("r1", "idle", "idle", { name: "lead" })], {
      messages: [
        message(1, {
          from: { kind: "agent", id: "r1", parent: null },
          to: "you",
          body: "Done.",
        }),
      ],
    });
    await waitFor(() =>
      expect(document.querySelector("[data-message-body]")).not.toBeNull(),
    );
    laidOut(document.querySelector("[data-message-body]"));
  });
});
