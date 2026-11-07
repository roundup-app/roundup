import { expect, it } from "vitest";
import { seedApp } from "../testing/seeds";
import { info } from "../testing/nodes";
import { prepareFixture } from "./fixture";

it("k3_setup_places_no_workstream_under_a_non_group_node", async () => {
  const { app } = seedApp("empty-project", Date.now());
  await app.subscribe(() => {});
  const home = await app.rpc("rail.createWorkstream", { name: "measure", parent: null });

  await expect(app.rpc("rail.createWorkstream", { name: "nested", parent: home.id })).rejects.toThrow("Workstreams never nest");

  const tree = await app.rpc("rail.tree", null);
  expect(tree).toHaveLength(1);
  app.handlers["agent.signal"] = () => null;
  app.handlers["terminal.list"] = () => [info("shell")];
  // The seeds hold no Todo, Pad or Status stores, so the readback may differ; only the Rail writes are K3's setup under test.
  await prepareFixture(app, "/temporary", "shell").catch((failure: Error) => expect(failure.message).not.toContain("never nest"));

  expect(await app.rpc("rail.tree", null)).toHaveLength(40);
});
