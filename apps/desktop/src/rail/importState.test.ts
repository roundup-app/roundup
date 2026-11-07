import { expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { createImport } from "./importState";

it("u6414a_the_import_flow_spawn_says_its_name_is_the_app_s", async () => {
  const app = createFakeApp();

  app.handlers["agent.spawn"] = () => agent("a1");
  await createImport(app, "/p", () => undefined).start();
  expect(app.calls.filter((call) => call.method === "agent.spawn").map((call) => call.params)).toEqual([
    expect.objectContaining({ appNamed: true }),
  ]);
});
