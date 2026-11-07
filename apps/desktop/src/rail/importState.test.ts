import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { createImport } from "./importState";
import { chord, mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

it("u6414a_the_import_flow_spawn_says_its_name_is_the_app_s", async () => {
  const app = createFakeApp();

  app.handlers["agent.spawn"] = () => agent("a1", "working", "working");
  await createImport(app, "/p", () => undefined).start();
  expect(app.calls.filter((call) => call.method === "agent.spawn").map((call) => call.params)).toEqual([
    expect.objectContaining({ appNamed: true }),
  ]);
});

it("u6463a_the_new_agent_dialog_spawn_carries_no_app_named", async () => {
  const mounted = await mountRail([]);

  mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");
  chord("n");
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));
  expect(railCallsTo(mounted.app, "agent.spawn")[0]).not.toHaveProperty("appNamed");
});
