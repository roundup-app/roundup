import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { chooseAction, mountRail, rowOf, settled } from "./railFixture";
import { agent, NOW, workstream } from "../testing/nodes";

afterEach(cleanup);

const LABEL = "Claude's servers failed; send the Agent a message to retry. The next turn replaces this mark.";

describe("U5151a", () => {
  it("u5151a_stop_failure_reaches_the_rail", async () => {
    const boom = agent("boom", "error", "x", { status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });

    await mountRail([boom]);

    expect(rowOf("boom").textContent).toContain(boom.status!.label);
  });
});

describe("U5151c", () => {
  it("u5151c_dismissal_clears_only_the_chosen_failure", async () => {
    const failed = (id: string) => agent(id, "error", "x", { status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });
    const { app, rail } = await mountRail([failed("one"), failed("two")]);

    await chooseAction(app, "one", "Dismiss error");
    fireEvent.click(rowOf("one"));
    await settled();

    expect(rowOf("one").getAttribute("data-kind")).toBe("idle");
    expect(rowOf("one").textContent).toContain(`Dismissed: ${LABEL}`);
    expect(rowOf("one").closest("[role=treeitem]")?.getAttribute("aria-label") ?? rowOf("one").getAttribute("aria-label")).toContain(`Dismissed: ${LABEL}`);
    expect(rowOf("two").getAttribute("data-kind")).toBe("error");
    expect(rail.dismissed(rail.nodes.find((node) => node.id === "one")!)).toBe(true);
    expect(rail.dismissed(rail.nodes.find((node) => node.id === "two")!)).toBe(false);
    expect(app.calls.map((call) => call.method).filter((method) => /^(agent|terminal)\.(send|write|stop|restart)|^(message|workstream)\./.test(method))).toEqual([]);
  });

  it("u5151c_dismissal_clears_a_collapsed_workstream_summary", async () => {
    const failed = agent("nested", "error", "x", { parent: "g", status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });
    const { app } = await mountRail([workstream("g"), failed]);

    await chooseAction(app, "nested", "Dismiss error");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));

    expect(rowOf("g").getAttribute("data-kind")).not.toBe("error");
  });
});
