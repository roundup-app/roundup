import { batch } from "solid-js";
import { copy } from "../copy";
import { cleanup, fireEvent, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent, door, mode } from "../../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf } from "../railFixture";

afterEach(() => batch(cleanup));

const open = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });

it.each([["normal", false], ["yolo", true]] as const)("u7191a_restart_calls_resume_with_the_current_mode_%s", async (mode, yolo) => {
  const { app } = await mountRail([agent("a", "idle", "ready", { yolo, has_conversation: true })]);
  app.handlers["agent.resume"] = () => agent("a", "idle", "ready", { yolo, has_conversation: true });

  open("a");
  await app.pickMenu(copy.restart);

  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a", mode }]));
});

it("u7191a_yolo_to_normal_is_start_normal", async () => {
  const { app } = await mountRail([agent("a", "idle", "ready", { yolo: true, has_conversation: true })]);

  open("a");

  expect(app.menuLabels().filter(label => label === copy.restart || label === copy.startNormal)).toEqual([copy.restart, copy.startNormal]);
});

it("u7191a_a_mode_restart_icon_menu_and_key_run_one_action", async () => {
  const saved = mode("m", "saved", { status: { kind: "idle", label: "", since: 0, finished: "0" }, has_conversation: true });
  const { app, rail } = await mountRail([saved]);
  app.handlers["agent.resume"] = () => saved;
  const row = rowOf("m");

  fireEvent.click(within(row).getByRole("button", { name: copy.restart }));
  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toHaveLength(1));
  await rail.settled();
  open("m");
  expect(app.shownMenus.at(-1)?.items.find(item => item.label === copy.restart)?.shortcut).toBe("R");
  await app.pickMenu(copy.restart);
  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toHaveLength(2));
  await rail.settled();
  row.focus();
  fireEvent.keyDown(row, { key: "r", code: "KeyR" });

  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual(Array.from({ length: 3 }, () => ({ id: "m", mode: "normal" }))));
  expect(railCallsTo(app, "agent.restartMode")).toEqual([]);
});

it("u7191a_an_exited_row_lists_one_restart_and_no_resume", async () => {
  const { app } = await mountRail([agent("a", "done", "stopped", { can_resume: true, has_conversation: true })], [exitedTerminal("a", 0)]);
  app.handlers["agent.resume"] = () => agent("a", "idle", "ready", { has_conversation: true });

  open("a");
  expect(app.menuLabels().filter(label => label === copy.restart || label === copy.resume)).toEqual([copy.restart]);
  expect(app.shownMenus.at(-1)?.items.find(item => item.label === copy.restart)?.shortcut).toBeUndefined();
  await app.pickMenu(copy.restart);

  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a", mode: "normal" }]));
});

it("u7191b_restart_is_absent_without_a_conversation", async () => {
  const { app } = await mountRail([door("w", "idle", "ready"), agent("a", "done", "stopped", { can_resume: true })], [exitedTerminal("a", 0)]);

  open("w");
  expect(app.menuLabels()).not.toContain(copy.restart);
  await app.closeMenu();
  open("a");
  expect(app.menuLabels()).not.toContain(copy.restart);
});

it("u7191b_restart_asks_only_when_it_interrupts_work", async () => {
  const { app } = await mountRail([agent("mid", "working", "busy", { has_conversation: true }), agent("calm", "idle", "ready", { has_conversation: true })]);
  app.handlers["agent.resume"] = () => agent("mid", "working", "busy", { has_conversation: true });

  open("calm");
  await app.pickMenu(copy.restart);
  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "calm", mode: "normal" }]));
  expect(app.questions).toEqual([]);

  open("mid");
  await app.pickMenu(copy.restart);
  await waitFor(() => expect(app.questions).toHaveLength(1));
  app.answerQuestion?.(false);
  expect(railCallsTo(app, "agent.resume")).toHaveLength(1);

  open("mid");
  await app.pickMenu(copy.restart);
  await waitFor(() => expect(app.questions).toHaveLength(2));
  app.answerQuestion?.(true);
  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "calm", mode: "normal" }, { id: "mid", mode: "normal" }]));
});

it("u7191c_the_row_shows_the_restart_failure", async () => {
  const { app, rail } = await mountRail([agent("a", "idle", "ready", { has_conversation: true })]);
  app.handlers["agent.resume"] = () => { throw new RpcError(-32003, "a has no saved conversation"); };

  open("a");
  await app.pickMenu(copy.restart);

  await waitFor(() => expect(rail.commandFailure.message()).toContain("a has no saved conversation"));
  open("a");
  expect(app.menuLabels()).toContain(copy.restart);
});
