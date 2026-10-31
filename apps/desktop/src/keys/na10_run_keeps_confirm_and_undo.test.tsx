import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { answerQuestion, questionDialog } from "../shelf/bulkQuestionHarness";
import { agent } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "../rail/railFixture";
import { answerRun } from "./actions";

afterEach(cleanup);

const CMD_BACKSPACE = { key: "Backspace", code: "Backspace", metaKey: true };

const mount = async () => {
  const mounted = await mountRail([agent("a", "working", "busy"), agent("b", "idle", "x")]);
  mounted.app.handlers["rail.remove"] = () => null;
  mounted.rail.select("a");
  rowOf("a").focus();

  return mounted;
};

it("na10_run_keeps_confirm_and_undo_of_the_key", async () => {
  const keyed = await mount();
  fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);
  const keyTitle = (await questionDialog()).title;
  expect(railCallsTo(keyed.app, "rail.remove")).toEqual([]);
  await answerQuestion(true);
  await waitFor(() => expect(railCallsTo(keyed.app, "rail.remove")).toEqual([{ id: "a" }]));
  const keyCalls = railCallsTo(keyed.app, "rail.remove");
  cleanup();

  const relayed = await mount();
  expect(await answerRun({ name: "rail.remove", args: [] })).toEqual({ result: { status: "awaiting" } });
  expect((await questionDialog()).title).toBe(keyTitle);
  expect(railCallsTo(relayed.app, "rail.remove")).toEqual([]);
  await answerQuestion(true);
  await waitFor(() => expect(railCallsTo(relayed.app, "rail.remove")).toEqual(keyCalls));
});

it("na10_an_argument_cannot_carry_a_confirmation", async () => {
  const { app } = await mount();
  expect(await answerRun({ name: "rail.remove", args: [{ key: "confirm", value: "true" }] })).toMatchObject({ error: { code: -32602, message: expect.stringContaining("confirm") } });
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});
