import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { copy } from "./copy";
import { door, workstream } from "../testing/nodes";
import { mountRailAndPane } from "./paneHarness";

afterEach(cleanup);

it("u471_action_labels_describe_the_existing_action_retry_supervisor", async () => {

  const { app, connected } = await mountRailAndPane([workstream("w")]);

  app.handlers["rail.startDoor"] = () => { throw new Error("keep THIS launch failure 🧭"); };

  connected.rail.select("w");
  fireEvent.click((await screen.findAllByRole("button", { name: copy.start })).find((button) => button.closest(".pane-door"))!);
  const retry = (await screen.findAllByRole("button", { name: copy.retry })).find((button) => button.closest(".pane-door"))!;

  expect(document.body.textContent).toContain("keep THIS launch failure 🧭");
  app.handlers["rail.startDoor"] = () => door("w", "working", "starting");
  fireEvent.click(retry);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "rail.startDoor").map((call) => call.params)).toEqual([{ id: "w" }, { id: "w" }]));
  expect(connected.rail.selected()).toBe("w");
  expect(app.calls.filter((call) => call.method === "rail.createWorkstream")).toEqual([]);
});
