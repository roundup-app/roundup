import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { event, info, node } from "../testing/nodes";
import { mountPane } from "./paneHarness";
import { Pane } from "./Pane";

afterEach(cleanup);

describe("u38 empty Pane", () => {
  it("u38_a_selected_agent_shows_no_empty_pane_text", async () => {
    const { connected } = await mountPane([node("a")]);

    connected.rail.select("a");

    expect(screen.queryByText("Select an Agent or a Terminal")).toBeNull();
  });

  it("u38_the_empty_pane_text_returns_once_the_selected_row_is_removed", async () => {
    const tree = [node("a"), node("b")];
    const { app, connected } = await mountPane(tree, [info("t-a")]);

    connected.rail.select("a");
    expect(screen.queryByText("Select an Agent or a Terminal")).toBeNull();

    tree.shift();
    app.emit(event({ name: "rail.changed" }));

    expect(await screen.findByText("Select an Agent or a Terminal")).toBeTruthy();
  });

  it("u38_a_failed_output_subscription_hides_the_empty_pane_text_with_nothing_selected", async () => {
    const { app, connected } = await mountPane([node("a")], [info("t-a")]);

    app.outputFailure = new RpcError(-32603, "channel refused");
    connected.rail.select("a");
    await screen.findByRole("alert", { name: "terminal.output: channel refused" });
    connected.rail.select(null);

    expect(screen.queryByText("Select an Agent or a Terminal")).toBeNull();
    expect(screen.getByRole("alert").querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });

  it("u38_a_failed_initial_rail_tree_shows_no_empty_pane_text", async () => {
    const app = createFakeApp();

    app.handlers["rail.tree"] = () => {
      throw new RpcError(-32603, "daemon is gone");
    };

    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <Pane notice={connected.rail.failure()} />
      </ConnectedProjectContext.Provider>
    ));

    expect(screen.queryByText("Select an Agent or a Terminal")).toBeNull();
  });
});
