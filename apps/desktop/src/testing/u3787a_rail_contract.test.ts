import { afterAll, beforeAll, expect, it } from "vitest";
import { createFakeApp } from "./fakeApp";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => { real = await startRealDaemon({}); });

afterAll(async () => { await real?.stop(); });

it("u3787a_app_and_fake_carry_the_original_operation_through_the_real_daemon", async () => {
  const app = createServedApp(real.base);
  const fake = createFakeApp();
  fake.handlers["rail.remove"] = params => app.rpc("rail.remove", params);
  fake.handlers["rail.deletion"] = params => app.rpc("rail.deletion", params);
  fake.handlers["rail.restore"] = params => app.rpc("rail.restore", params);
  const node = await app.rpc("rail.createWorkstream", { name: "retained", parent: null });
  const before = await app.rpc("rail.tree", null);
  const removed = await fake.rpc("rail.remove", { id: node.id, operation: "app-captured" });

  if (!removed?.deletion) throw new Error("the Daemon did not retain the chosen removal");

  expect(await app.rpc("rail.tree", null)).toEqual([]);
  expect(await fake.rpc("rail.deletion", removed.deletion)).toEqual(removed);
  const restored = await fake.rpc("rail.restore", removed.deletion);

  expect(restored.deletion?.restored).toBe(true);
  expect(await app.rpc("rail.tree", null)).toEqual(before);
  expect(await fake.rpc("rail.remove", { id: node.id, operation: "app-captured" })).toEqual(restored);
});
