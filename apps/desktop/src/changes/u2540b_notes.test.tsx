import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { agent, event } from "../testing/nodes";
import { WORKTREE } from "./harness";
import { message } from "../testing/centreFixture";
import { afterEach, expect, it } from "vitest";
import { COMPARISON, openDiff, openFile, saveNote } from "./noteHarness";

afterEach(cleanup);

it("u2540b_save_cancel_and_invalid_ranges", async () => {
  await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  keep exact\ntext  " } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "99" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "1" } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "2" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "0" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "1" } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "2" } });
  fireEvent.click(save);
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("  keep exact\ntext  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "cancel me" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("list", { name: "Notes" }).textContent).not.toContain("cancel me");
});

it("u2540b_close_and_reopen_keep_unsent_notes", async () => {
  await openDiff();
  await saveNote("retain me");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  expect((await screen.findByRole("list", { name: "Notes" })).textContent).toContain("retain me");
});

it("u2540b_edit_remove_and_batch_across_files", async () => {
  await openDiff();
  await saveNote("first");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await openFile("src/deep/b.ts");
  await saveNote("second");
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "edited first" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const batch = screen.getByRole("list", { name: "Notes" });
  expect(batch.textContent).toContain("edited first");
  expect(batch.textContent).toContain("src/deep/b.ts");
  fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  expect(batch.textContent).not.toContain("edited first");
  expect(batch.textContent).toContain("second");
});

it("u2540b_batches_belong_to_their_agent", async () => {
  const { app, connected } = await openDiff();
  await saveNote("for a only");
  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE }), agent("b", "working", "building", { worktree: { ...WORKTREE, branch: "roundup/b", path: "/p/b" } })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "b")).toBe(true));
  connected.rail.select("b");
  fireEvent.click(screen.getByRole("button", { name: "roundup/b" }));
  expect(screen.queryByRole("list", { name: "Notes" })).toBeNull();
  await openFile();
  await saveNote("for b only");
  connected.rail.select("a");
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  const batch = await screen.findByRole("list", { name: "Notes" });
  expect(batch.textContent).toContain("for a only");
  expect(batch.textContent).not.toContain("for b only");
  app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  connected.rail.select("b");
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a" });
  fireEvent.click(screen.getByRole("button", { name: "roundup/b" }));
  expect((await screen.findByRole("list", { name: "Notes" })).textContent).toContain("for b only");
});

it("u2540b_refresh_keeps_original_context", async () => {
  const { app } = await openDiff();
  await saveNote("original");
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "later-revision", text: "different\n" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("Original context"));
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "original");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  app.handlers["message.send"] = params => message(1, { body: params.body, to: params.to });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  const body = app.calls.find(call => call.method === "message.send")!.params;
  expect(JSON.stringify(body)).toContain("new-revision");
  expect(JSON.stringify(body)).not.toContain("later-revision");
});
