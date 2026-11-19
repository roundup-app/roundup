import { notice } from "../../testing/notices";
import { copy } from "../copy";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent, door, mode } from "../../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf } from "../railFixture";

afterEach(cleanup);

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

const stopped = (conversation: boolean) => mode("m", "saved", { status: { kind: "idle", label: "", since: 0, finished: "0" }, has_conversation: conversation });

it("u7493a_a_mode_restart_always_runs_restart_mode", async () => {
  const { app, rail } = await mountRail([stopped(true)]);
  app.handlers["agent.restartMode"] = () => stopped(true);
  const row = rowOf("m");

  fireEvent.click(within(row).getByRole("button", { name: copy.restart }));
  await waitFor(() => expect(railCallsTo(app, "agent.restartMode")).toHaveLength(1));
  await rail.settled();
  open("m");
  expect(app.shownMenus.at(-1)?.items.find(item => item.label === copy.restart)?.shortcut).toBe("R");
  await app.pickMenu(copy.restart);
  await waitFor(() => expect(railCallsTo(app, "agent.restartMode")).toHaveLength(2));
  await rail.settled();
  row.focus();
  fireEvent.keyDown(row, { key: "r", code: "KeyR" });

  await waitFor(() => expect(railCallsTo(app, "agent.restartMode")).toHaveLength(3));
  expect(railCallsTo(app, "agent.resume")).toEqual([]);
});

it("u7493a_a_stopped_mode_play_icon_resumes_its_conversation", async () => {
  const { app } = await mountRail([stopped(true)], [exitedTerminal("m", 0)]);
  app.handlers["agent.resume"] = () => stopped(true);

  fireEvent.click(within(rowOf("m")).getByRole("button", { name: copy.resume }));

  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "m", mode: "normal" }]));
  expect(railCallsTo(app, "agent.restartMode")).toEqual([]);
});

it("u7493a_a_mode_without_a_conversation_has_no_play_icon", async () => {
  await mountRail([stopped(false)], [exitedTerminal("m", 0)]);

  const buttons = within(rowOf("m")).getAllByRole("button");

  expect(buttons.some(b => b.querySelector(".lucide-play"))).toBe(false);
  expect(within(rowOf("m")).queryByRole("button", { name: copy.resume })).toBeNull();
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

it("u7191a_an_exited_restart_with_a_lost_reply_retries_the_same_request", async () => {
  const { app, rail } = await mountRail([agent("a", "done", "stopped", { can_resume: true, has_conversation: true })], [exitedTerminal("a", 0)]);
  const lost = new RpcError(-32004, "the Daemon may have run the call");
  app.handlers["agent.resume"] = () => {
    app.handlers["rail.tree"] = () => { throw new RpcError(-32000, "down"); };

    throw lost;
  };

  open("a");
  await app.pickMenu(copy.restart);
  await waitFor(() => expect(notice("alert")).toBeTruthy());
  await rail.settled();
  open("a");
  await app.pickMenu(copy.restart);

  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a", mode: "normal" }, { id: "a", mode: "normal" }]));
});

it("u7191a_restarting_an_exited_row_selects_it", async () => {
  const { app, rail } = await mountRail([agent("a", "done", "stopped", { can_resume: true, has_conversation: true }), agent("b", "idle", "ready")], [exitedTerminal("a", 0)]);
  app.handlers["agent.resume"] = () => agent("a", "idle", "ready", { has_conversation: true });

  expect(rail.selected()).not.toBe("a");
  open("a");
  await app.pickMenu(copy.restart);

  await waitFor(() => expect(rail.selected()).toBe("a"));
});

it("u7191a_the_exited_row_icon_is_labelled_restart", async () => {
  const { app } = await mountRail([agent("a", "done", "stopped", { can_resume: true, has_conversation: true })], [exitedTerminal("a", 0)]);
  app.handlers["agent.resume"] = () => agent("a", "idle", "ready", { has_conversation: true });

  fireEvent.click(within(rowOf("a")).getByRole("button", { name: copy.restart }));

  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a", mode: "normal" }]));
});

it("u7493a_other_agents_keep_restart_on_resume", async () => {
  const { app } = await mountRail([agent("a", "idle", "ready", { has_conversation: true })]);
  app.handlers["agent.resume"] = () => agent("a", "idle", "ready", { has_conversation: true });

  open("a");
  await app.pickMenu(copy.restart);

  await waitFor(() => expect(railCallsTo(app, "agent.resume")).toHaveLength(1));
  expect(railCallsTo(app, "agent.restartMode")).toEqual([]);
});
