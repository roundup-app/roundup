import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { diffsLoaded } from "./diffDraw";
import { mountControl } from "./harness";
import { COMPARISON, openChanges, openFirstModule } from "./noteHarness";

afterEach(cleanup);

it("u2540d_renderer_loads_only_on_demand", async () => {
  const { app, connected } = await mountControl();
  expect(diffsLoaded()).toBe(false);
  connected.rail.select("plain");
  connected.rail.select("a");
  expect(diffsLoaded()).toBe(false);
  app.handlers["agent.compareFile"] = () => COMPARISON;
  await openChanges();
  await openFirstModule();
  await waitFor(() => expect(diffsLoaded()).toBe(true));
});
