import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door } from "../testing/nodes";
import { mountCentre } from "../testing/centreFixture";
import { RpcError } from "../app/seam";

afterEach(cleanup);

const dismiss = () => fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

it.each(["dismissal", "selection moves to another item"] as const)("p3557c_failure_lifetime_pane_takeover_%s", async (action) => {
  const { app, connected } = await mountCentre([door("workstream", "idle", "idle", { name: "lead" }), agent("a", "working", "x", { parent: "workstream", name: "ann", terminal_id: "t-a" }), agent("b", "working", "x", { parent: "workstream", name: "bo", terminal_id: "t-b" })], { select: "a" });

  app.handlers["takeover.begin"] = () => { throw new RpcError(-32603, "Takeover refused"); };

  fireEvent.click(await screen.findByRole("button", { name: "Take control" }));
  await screen.findByRole("alert", { name: /Takeover refused/ });

  const calls = app.calls.length;

  if (action === "dismissal") {
    dismiss();
    await waitFor(() => expect(screen.queryByRole("alert", { name: /Takeover refused/ })).toBeNull());
    expect(app.calls.length).toBe(calls);
    expect(connected.rail.selected()).toBe("a");
  } else {
    connected.rail.select("b");
    await waitFor(() => expect(screen.queryByRole("alert", { name: /Takeover refused/ })).toBeNull());
  }
});
