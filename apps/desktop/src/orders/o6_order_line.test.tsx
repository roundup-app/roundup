import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { mountApp, select } from "../testing/appFixture";
import { agent, clarifying, door, event } from "../testing/nodes";

const work = {
  kind: "work" as const,
  ask: "fix the build",
  limits: ["touch main", "skip tests"],
};

const mount = () =>
  mountApp((app) => {
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

  it("o6_a_clarification_order_agent_shows_its_question_and_a_door_shows_none", async () => {
    await mount();

    select("beta");
    await waitFor(() =>
      expect(line()?.textContent).toBe("Clarifying: which build?"),
    );

    select("harbor");
    // U467: a Workstream's Door shows only its Terminal, so no order line sits above it.
    await waitFor(() => expect(line()).toBeNull());
    expect(line()).toBeNull();
  });

  it("o2_an_agent_that_holds_no_order_shows_no_line", async () => {
    await mountApp((app) => {
      // A spawn with neither prompt nor order holds no order (O2).
      app.handlers["rail.tree"] = () => [0, 1, 2].map((order) => agent(`p${order}`, "working", "editing", { name: `pip${order}`, order, work: null }));
    });
    select("pip0");

    await waitFor(() => expect(document.querySelector(".pane")).not.toBeNull());
    expect(line()).toBeNull();
  });

  it("o6_activating_the_line_opens_the_whole_order_in_the_drawer", async () => {
    await mount();
    select("alpha");

    await waitFor(() => expect(line()).not.toBeNull());
    fireEvent.click(line()!);

    await waitFor(() =>
      expect(
        screen.getByLabelText("Full order of alpha").textContent,
      ).toContain("fix the build"),
    );
    expect(
      screen.getByLabelText("Full order of alpha").textContent,
    ).not.toContain("skip tests");
  });

  it("o6_activating_the_line_after_a_selection_change_opens_the_order_of_the_new_selection", async () => {
    await mount();
    select("alpha");
    await waitFor(() => expect(line()).not.toBeNull());

    select("beta");
    await waitFor(() =>
      expect(line()?.textContent).toBe("Clarifying: which build?"),
    );
    fireEvent.click(line()!);

    await waitFor(() =>
      expect(screen.getByLabelText("Full order of beta").textContent).toContain(
        "which build?",
      ),
    );
    expect(screen.queryByLabelText("Full order of alpha")).toBeNull();
  });
  it("o6_an_open_order_drawer_closes_when_the_agent_exits_and_the_order_moves_inline", async () => {
    const { app } = await mount();

    select("alpha");
    await waitFor(() => expect(line()).not.toBeNull());
    fireEvent.click(line()!);
    await screen.findByLabelText("Full order of alpha");
    app.emit(event({ name: "terminal.exited", data: { id: "t-a", code: 0 } }));

    await waitFor(() => expect(line()).toBeNull());
    await waitFor(() => expect(document.querySelector(".order-drawer")).toBeNull());
    expect(document.querySelector(".order-overview")?.textContent).toContain(work.ask);
  });

});
