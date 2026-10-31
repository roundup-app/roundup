import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { node } from "../testing/nodes";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Pane } from "../terminal/Pane";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u5301b_a_read_failure_retries_by_calling_the_read_again", async () => {
  const app = createFakeApp();
  app.handlers["terminal.list"] = () => [];
  app.handlers["rail.tree"] = () => { throw new RpcError(-32603, "no reply to rail.tree within 5s"); };
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);

  render(() => <ConnectedProjectContext.Provider value={connected}>
    <Pane notice={connected.rail.failure()} retryNotice={() => void connected.rail.refresh({ terminals: true })} />
  </ConnectedProjectContext.Provider>);

  try {
    await screen.findByRole("alert");
    const reads = () => app.calls.filter(call => call.method === "rail.tree").length;
    const before = reads();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    await connected.rail.settled();
    await screen.findByRole("alert");
    const afterFailedPress = reads();
    app.handlers["rail.tree"] = () => [node("a", { name: "Back" })];
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(connected.rail.failure()).toBeNull());
    expect(reads()).toBe(afterFailedPress + 1);
  } finally { connected.stopTerminalScheme(); }
});
