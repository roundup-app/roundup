import { batch } from "solid-js";
import { copy } from "../copy";
import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../../app/seam";
import { agent, door } from "../../testing/nodes";
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
  const { app } = await mountRail([agent("a", "idle", "ready", { has_conversation: true })]);
  app.handlers["agent.resume"] = () => { throw new RpcError(-32003, "a has no saved conversation"); };

  open("a");
  await app.pickMenu(copy.restart);

  await waitFor(() => expect(document.body.textContent).toContain("a has no saved conversation"));
  open("a");
  expect(app.menuLabels()).toContain(copy.restart);
});
