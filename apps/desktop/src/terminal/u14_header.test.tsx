import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountPane } from "./paneHarness";
import { RpcError } from "../app/seam";
import { info, node } from "../testing/nodes";

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

  it("u13_an_error_line_shows_with_a_dismiss_icon", async () => {
    const { app, connected } = await mountPane([node("a")], [info("t-a")]);

    app.outputFailure = new RpcError(-32603, "channel refused");
    connected.rail.select("a");
    const failure = await screen.findByRole("alert", { name: /^terminal\.output:/ });

    expect(failure.querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });
});
