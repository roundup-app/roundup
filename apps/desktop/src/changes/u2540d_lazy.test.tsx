import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { diffsLoaded } from "./DiffReader";
import { mountControl } from "./harness";
import { COMPARISON, openFile } from "./noteHarness";

afterEach(cleanup);

it("u2540d_renderer_loads_only_on_demand", async () => {
  const { app, connected } = await mountControl();
  expect(diffsLoaded()).toBe(false);
  connected.rail.select("plain");
  connected.rail.select("a");
  expect(diffsLoaded()).toBe(false);
  app.handlers["agent.compareFile"] = () => COMPARISON;
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  expect(diffsLoaded()).toBe(false);
  await openFile();
  await waitFor(() => expect(diffsLoaded()).toBe(true));
});
