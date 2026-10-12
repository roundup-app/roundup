import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { mountApp, select } from "../decisions/decisionsFixture";
import { agent, clarifying, door } from "../testing/nodes";

const work = {
  kind: "work" as const,
  ask: "fix the build",
  limits: ["touch main", "skip tests"],
};

const mount = () =>
  mountApp([], (app) => {
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

const line = () => document.querySelector<HTMLElement>(".order-line");

describe("O6: the order on one line above the Terminal", () => {
  it("o6_a_work_order_agent_shows_its_ask_and_the_count_of_its_limits", async () => {
    await mount();
    select("alpha");

    await waitFor(() =>
      expect(line()?.textContent).toBe("fix the build · 2 limits"),
    );
  });

  it("o6_a_clarification_order_agent_and_a_door_show_their_question", async () => {
    await mount();

    select("beta");
    await waitFor(() =>
      expect(line()?.textContent).toBe("clarifying: which build?"),
    );

    select("harbor");
    // U422: a Workstream's order is the Thread's goal line, not the line above the Terminal.
    await waitFor(() =>
      expect(
        document.querySelector(
          "[data-thread-header] [aria-label='order of harbor']",
        )?.textContent,
      ).toBe("what is this Workstream for?"),
    );
    expect(line()).toBeNull();
  });

  it("o6_the_line_sits_below_the_decision_card_and_above_the_terminal", async () => {
    await mount();
    select("alpha");

    await waitFor(() => expect(line()).not.toBeNull());
    const body = document.querySelector(".pane-body")!;

    expect(
      line()!.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("o6_activating_the_line_opens_the_whole_order_in_the_drawer", async () => {
    await mount();
    select("alpha");

    await waitFor(() => expect(line()).not.toBeNull());
    fireEvent.click(line()!);

    await waitFor(() =>
      expect(
        screen.getByLabelText("full order of alpha").textContent,
      ).toContain("fix the build"),
    );
    expect(screen.getByLabelText("full order of alpha").textContent).toContain(
      "skip tests",
    );
  });

  it("o6_activating_the_line_after_a_selection_change_opens_the_order_of_the_new_selection", async () => {
    await mount();
    select("alpha");
    await waitFor(() => expect(line()).not.toBeNull());

    select("beta");
    await waitFor(() =>
      expect(line()?.textContent).toBe("clarifying: which build?"),
    );
    fireEvent.click(line()!);

    await waitFor(() =>
      expect(screen.getByLabelText("full order of beta").textContent).toContain(
        "which build?",
      ),
    );
    expect(screen.queryByLabelText("full order of alpha")).toBeNull();
  });
});
