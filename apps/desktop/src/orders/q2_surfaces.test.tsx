import { agent, door } from "../testing/nodes";
import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp } from "../testing/appFixture";
import { openRecovery } from "../testing/recovery";

const destination = { surface: "orders", object: "a", recipient: "a" };

const value = { done: " \t完成\n ", ask: "\n 草稿 🧭  ", title: "  é\t ", baseAsk: "old", field: "ask" };

const exact = "  é\t \n\n 草稿 🧭  \n \t完成\n ";

it("u4453b_retired_order_drafts_keep_exact_copy_and_identity", async () => {
  const first = await mountApp();
  const draft = first.drafts("/p").edit(destination, value, null, "ordinary").draft;
  await first.drafts("/p").submit(draft.revision);
  first.drafts("/p").settle(draft.revision, "unknown");
  await first.drafts("/p").retry();

  cleanup();

  // mountApp clears storage only between tests, so this mount reads the persisted revision.
  const { app, drafts } = await mountApp(fake => {
    fake.add("/elsewhere");
    fake.handlers["rail.tree"] = () => [agent("b", "working", "working"), agent("c", "working", "working"), door("r", "done", "finished")];
    fake.of("/elsewhere").handlers["rail.tree"] = fake.handlers["rail.tree"];
  });

  fireEvent.click(await screen.findByRole("tab", { name: /^elsewhere/ }));
  fireEvent.click(await screen.findByRole("tab", { name: /^p/ }));
  await openRecovery();
  const recovery = within(await screen.findByRole("region", { name: "Unfinished work" }));
  expect(recovery.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(recovery.getByRole("button", { name: "Copy" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(app.clipboardWrites).toEqual([exact]);
  expect(drafts("/p").list()).toMatchObject([{ revision: draft.revision, destination, value, status: "unknown" }]);
  expect(app.calls.filter(call => call.method === "agent.setOrder")).toEqual([]);
});

it("u4453b_retired_order_draft_copy_failure_and_selected_discard", async () => {
  const { app, drafts } = await mountApp();
  const holder = drafts("/p");
  const older = holder.edit(destination, value, null, "ordinary").draft;
  await holder.submit(older.revision);
  holder.settle(older.revision, "failed");
  const newer = holder.edit(destination, { ...value, ask: " newer " }, null, "ordinary").draft;
  const elsewhere = drafts("/elsewhere").edit(destination, { ...value, title: "other Project" }, null, "ordinary").draft;
  await openRecovery();
  const row = document.querySelector<HTMLElement>(`[data-revision="${older.revision}"]`)!;
  app.clipboardFailure = new Error("Clipboard unavailable; retry Copy");
  fireEvent.click(within(row).getByRole("button", { name: "Copy" }));
  await within(row).findByRole("alert");
  expect(holder.list()).toHaveLength(2);
  app.clipboardFailure = null;
  fireEvent.click(within(row).getByRole("button", { name: "Copy" }));
  await within(row).findByRole("button", { name: "Copied" });
  fireEvent.click(within(row).getByRole("button", { name: "Discard" }));
  expect(holder.list()).toEqual([newer]);
  expect(drafts("/elsewhere").list()).toEqual([elsewhere]);
  expect(app.clipboardWrites).toEqual([exact]);
  expect(app.calls.filter(call => call.method === "agent.setOrder")).toEqual([]);
});
