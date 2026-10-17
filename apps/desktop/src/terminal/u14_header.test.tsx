import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import pane from "./styles.css?inline";
import { mountPane } from "./paneHarness";
import { event, info, node } from "../testing/nodes";

const headerOf = (container: HTMLElement) => container.querySelector(".pane-title")?.textContent ?? "";

afterEach(cleanup);

describe("pane empty states and error sizing", () => {
  it("u14_a_group_has_no_header", async () => {
    const { connected, container } = await mountPane([node("g", { kind: "workstream", status: null, terminal_id: null })]);

    connected.rail.select("g");

    expect([headerOf(container), screen.queryByText("stop")]).toEqual(["", null]);
  });

  it("u38_with_nothing_selected_the_pane_reads_select_an_agent_or_a_terminal", async () => {
    const { container } = await mountPane([node("a")], [info("t-a")]);

    expect([headerOf(container), container.querySelector(".pane-screen")?.textContent, screen.queryByText("stop")]).toEqual([
      "",
      "",
      null,
    ]);
    expect(screen.getByText("Select an Agent or a Terminal")).toBeTruthy();
  });

  it("u13_an_error_line_shows_in_a_slot_that_reserves_no_height", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));

    sheet.textContent = pane;

    const { app, connected, container } = await mountPane([node("a")], [info("t-a")]);

    const box = () => {
      const slot = container.querySelector(".pane-failure");

      if (!slot) throw new Error("the pane has no failure slot");

      const style = getComputedStyle(slot);

      return [style.minHeight, style.flexShrink];
    };

    connected.rail.select("a");

    const before = box();

    app.emit(event({ name: "terminal.output", data: { id: "t-a", data: "***", offset: 0 } }));
    const failure = await screen.findByRole("alert", { name: /^terminal\.output:/ });

    const after = box();

    sheet.remove();

    expect([before, after]).toEqual([["auto", "0"], ["auto", "0"]]);
    expect(failure.querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });
});
