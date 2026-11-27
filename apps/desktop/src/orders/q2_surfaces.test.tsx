import { cleanup } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp } from "../testing/appFixture";

const destination = { surface: "orders", object: "a", recipient: "a" };

it("u7978c_retired_order_drafts_are_dropped_and_never_sent", async () => {
  const first = await mountApp();
  const draft = first.drafts("/p").edit(destination, { done: "完成", ask: "草稿", title: "é", baseAsk: "old", field: "ask" }, null, "ordinary").draft;
  await first.drafts("/p").submit(draft.revision);
  first.drafts("/p").settle(draft.revision, "unknown");
  await first.drafts("/p").retry();

  cleanup();

  // mountApp clears storage only between tests, so this mount reads the persisted revision.
  const { app, drafts } = await mountApp();

  expect(drafts("/p").list()).toEqual([]);
  expect(app.calls.filter(call => call.method === "agent.setOrder")).toEqual([]);
});
