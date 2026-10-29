import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountRail, railCallsTo, rowOf, chooseAction } from "./railFixture";
import { copy } from "../copy";
import { captureActions } from "../keys/registry";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4547d_restart_controls_share_the_focused_mode_action", async () => {
  const tree = [door("mode", "working", "", { opening_prompt: " exact\n ", yolo: true }), workstream("other")];
  const m = await mountRail(tree);
  m.app.handlers["workstream.restart"] = () => tree[0]!;
  m.rail.select("other");
  const row = rowOf("mode");
  fireEvent.click(within(row).getByRole("button", { name: copy.restart }));
  await waitFor(() => expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(1));
  await m.rail.settled();
  await chooseAction(m.app, "mode", copy.restart);
  row.focus();
  fireEvent.keyDown(row, { key: "r", code: "KeyR" });
  await waitFor(() => expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(3));
  expect(railCallsTo(m.app, "workstream.restart").every(p => (p as { id: string }).id === "mode")).toBe(true);
  expect(railCallsTo(m.app, "agent.resume")).toEqual([]);
  expect(captureActions(row).find(a => a.keys === "R")?.available()).toBe(true);
  rowOf("other").focus();
  expect(captureActions(document.activeElement).find(a => a.keys === "R")?.available()).toBe(false);
});

it("u4547d_pending_and_failed_restart_keep_one_operation", async () => {
  const tree = [workstream("mode", { opening_prompt: "prompt" })];
  const m = await mountRail(tree);
  let refuse!: (error: Error) => void;
  m.app.handlers["workstream.restart"] = () => new Promise((_, reject) => { refuse = reject; });
  const row = rowOf("mode");
  fireEvent.click(within(row).getByRole("button", { name: copy.restart }));
  row.focus();
  fireEvent.keyDown(row, { key: "r", code: "KeyR" });
  await chooseAction(m.app, "mode", copy.restart);
  expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(1);
  refuse(new RpcError(-32003, "Door could not start. Restore Claude, then retry."));
  await screen.findByText("Door could not start. Restore Claude, then retry.");
  const original = railCallsTo(m.app, "workstream.restart")[0];
  m.app.handlers["workstream.restart"] = () => tree[0]!;
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await waitFor(() => expect(railCallsTo(m.app, "workstream.restart")).toEqual([original, original]));
  expect(m.rail.nodes[0]?.opening_prompt).toBe("prompt");
});

it("u4547d_only_explicit_restart_requests_a_fresh_session", async () => {
  const tree = [workstream("mode", { opening_prompt: "saved" })];
  const m = await mountRail(tree);
  m.rail.select("mode");
  await m.rail.refresh();
  await chooseAction(m.app, "mode", copy.openingPromptMenu);
  const field = await screen.findByRole("textbox", { name: copy.openingPrompt });
  field.focus();
  expect(fireEvent.keyDown(field, { key: "r", code: "KeyR" })).toBe(true);
  fireEvent.input(field, { target: { value: "edited" } });
  m.app.handlers["workstream.setOpeningPrompt"] = () => null;
  fireEvent.blur(field);
  await waitFor(() => expect(railCallsTo(m.app, "workstream.setOpeningPrompt")).toHaveLength(1));
  expect(railCallsTo(m.app, "workstream.restart")).toEqual([]);
  cleanup();
  const reopened = await mountRail(tree);
  expect(railCallsTo(reopened.app, "workstream.restart")).toEqual([]);
});
