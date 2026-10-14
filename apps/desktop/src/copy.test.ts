import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream } from "./testing/nodes";
import { mountRailAndPane } from "./terminal/paneHarness";

afterEach(cleanup);

it("u471_action_labels_describe_the_existing_action_start_supervisor", async () => {
  const { app, connected } = await mountRailAndPane([workstream("w")]);
  app.handlers["rail.startDoor"] = () => door("w", "working", "starting");
  connected.rail.select("w");
  fireEvent.click(await screen.findByRole("button", { name: "Start supervisor" }));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "rail.startDoor").map((call) => call.params)).toEqual([{ id: "w" }]));
  expect(connected.rail.selected()).toBe("w");
});
