import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Message } from "@contracts/message/Message";
import { RpcError } from "../app/seam";
import { message } from "../testing/centreFixture";
import { openDiff, openFile, saveNote } from "./noteHarness";

afterEach(cleanup);

it("u2540c_one_message_contains_all_original_context", async () => {
  const { app } = await openDiff();
  await saveNote("  exact\ncomment <script>  ");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await openFile("src/deep/b.ts");
  await saveNote("second");
  let accepted: unknown;
  app.handlers["message.send"] = params => { accepted = JSON.parse(params.body);

 return message(1, { to: params.to, body: params.body }); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a", kind: "note", replyTo: null });
  expect(accepted).toMatchObject({ notes: [
    { "File:": { old: "src/a.ts", new: "src/a.ts" }, "Base:": "base-commit", "Content revisions:": { old: "old-revision", new: "new-revision" }, "Lines:": "new 1-1", "Selected source:": "after", "User comment:": "  exact\ncomment <script>  " },
    { "File:": { new: "src/deep/b.ts" }, "User comment:": "second" },
  ] });
});

it("u2540c_empty_batch_sends_nothing", async () => {
  const { app } = await openDiff();
  expect(screen.queryByRole("button", { name: /Send notes to/ })).toBeNull();
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2540c_acceptance_clears_only_the_submitted_batch", async () => {
  const { app } = await openDiff();
  await saveNote("submitted");
  let resolve!: (value: Message) => void;
  app.handlers["message.send"] = () => new Promise(done => { resolve = done; });
  const send = screen.getByRole("button", { name: /Send notes to/ });
  fireEvent.click(send);
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  fireEvent.click(send);
  await saveNote("added meanwhile");
  resolve(message(1, { to: "a", status: "held" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Notes" }).textContent).not.toContain("submitted"));
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("added meanwhile");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Agent notes" }).textContent).toContain("held");
});

it("u2540c_rejection_and_unknown_acceptance_preserve_notes", async () => {
  const { app } = await openDiff();
  await saveNote("keep");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "receiver ended"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByText("receiver ended");
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("keep");
  let body = "";
  app.handlers["message.send"] = params => { body = params.body; throw new Error("disconnected"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByRole("button", { name: "Check Message history" });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
  app.handlers["message.list"] = () => [message(9, { from: { kind: "user", id: "you", parent: null }, to: "a", body, status: "pending" })];
  fireEvent.click(screen.getByRole("button", { name: "Check Message history" }));
  await waitFor(() => expect(screen.queryByRole("list", { name: "Notes" })).toBeNull());
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
});
