import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, mode } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

it("a4452c_the_row_menu_opens_only_the_named_modes_prompt", async () => {
  const m = await mountRail([mode("w", "review", { name: "Plan" }), agent("a", "idle", "", { parent: "w" })]);
  m.rail.select("a");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.contextMenu(rowOf("a"));
  expect(m.app.menuLabels()).not.toContain("First prompt…");
  fireEvent.contextMenu(rowOf("Plan"));
  await m.app.pickMenu("First prompt…");
  await screen.findByRole("dialog", { name: "First prompt · Plan" });
  m.app.handlers["agent.setModePrompt"] = () => null;
  const field = await screen.findByRole("textbox", { name: "First prompt" });
  fireEvent.input(field, { target: { value: "Read the plan" } });
  expect(railCallsTo(m.app, "agent.setModePrompt")).toEqual([]);
  fireEvent.blur(field);
  await waitFor(() => expect(railCallsTo(m.app, "agent.setModePrompt")).toEqual([{ id: "w", prompt: "Read the plan" }]));
});

it("a4452c_a_refused_mode_prompt_keeps_the_original_mode_draft", async () => {
  const m = await mountRail([mode("w", "first"), mode("other", "second")], [], undefined, () => true);
  m.app.handlers["agent.setModePrompt"] = () => { throw new RpcError(-32003, "Save failed; retry"); };

  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu("First prompt…");
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" });
  fireEvent.input(field, { target: { value: "  /compose exact words\n" } });
  fireEvent.blur(field);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.contextMenu(rowOf("other"));
  await m.app.pickMenu("First prompt…");
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" })).value).toBe("second");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu("First prompt…");
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" })).value).toBe("  /compose exact words\n");
});

it.each(["Escape", "Close"])("a4452c_closing_with_%s_returns_focus_to_the_mode", async close => {
  const m = await mountRail([mode("w", "prompt")], [], undefined, () => true);
  const row = rowOf("w");
  row.focus();
  fireEvent.contextMenu(row);
  await m.app.pickMenu("First prompt…");
  const field = await screen.findByRole("textbox", { name: "First prompt" });
  field.focus();

  if (close === "Escape") fireEvent.keyDown(field, { key: "Escape" });
  else fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.activeElement).toBe(row));
});

it("a4452c_retry_saves_the_retained_prompt_without_refocusing_the_field", async () => {
  const m = await mountRail([mode("w", "prompt")], [], undefined, () => true);
  m.app.handlers["agent.setModePrompt"] = () => { throw new RpcError(-32003, "Save failed; retry"); };

  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu("First prompt…");
  const field = await screen.findByRole("textbox", { name: "First prompt" });
  fireEvent.input(field, { target: { value: "Read the plan\nThen run tests" } });
  fireEvent.blur(field);
  await screen.findByRole("alert");
  m.app.handlers["agent.setModePrompt"] = () => null;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(railCallsTo(m.app, "agent.setModePrompt")).toEqual([
    { id: "w", prompt: "Read the plan\nThen run tests" },
    { id: "w", prompt: "Read the plan\nThen run tests" },
  ]);
});

it("a4452c_restart_saves_first_and_retries_the_same_session_identity", async () => {
  const m = await mountRail([mode("w", "prompt")], [], undefined, () => true);
  const order: string[] = [];

  let finishSave = () => {};

  const saved = new Promise<void>(resolve => { finishSave = resolve; });

  m.app.handlers["agent.setModePrompt"] = async () => {
    order.push("save");
    await saved;

    return null;
  };

  m.app.handlers["agent.restartMode"] = () => { order.push("restart"); throw new RpcError(-32003, "Recording failed; retry restart"); };

  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu("First prompt…");
  const field = await screen.findByRole("textbox", { name: "First prompt" });
  fireEvent.input(field, { target: { value: "  My exact opening\n" } });
  fireEvent.blur(field);
  fireEvent.click(screen.getByRole("button", { name: "Restart" }));
  expect(railCallsTo(m.app, "agent.restartMode")).toEqual([]);
  finishSave();
  await screen.findByRole("alert");
  expect(order).toEqual(["save", "restart"]);
  const first = railCallsTo(m.app, "agent.restartMode")[0];
  m.app.handlers["agent.restartMode"] = () => mode("w", "  My exact opening\n");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.restartMode")).toEqual([first, first]));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(rowOf("w")));
});
