import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { node, info } from "../testing/nodes";
import { mountNotes, note, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const DOOR = { kind: "agent" as const, id: "d", parent: null };

const MODEL = { kind: "ext" as const, id: "rupd", parent: null };

const mount = async (messages = [note(1, "ask me", { from: DOOR, status: "held", reason: "ask-first" })]) => {
  const mounted = await mountNotes([node("a", { name: "Ann" }), node("d", { name: "Door" })], [info("t-a")], messages);

  mounted.connected.rail.select("a");
  await screen.findByText("t-a");

  return mounted;
};

it("u3783_only_an_ask_first_note_waits_for_the_user", async () => {
  const { app } = await mount([
    note(1, "auto", { from: DOOR, status: "delivered" }),
    note(2, "dropped", { from: DOOR, status: "dropped" }),
    note(3, "ask me", { from: DOOR, status: "held", reason: "ask-first" }),
    note(4, "model says", { from: MODEL, status: "held", reason: "ask-first" }),
  ]);

  await waitFor(() => expect(rowsOf()).toEqual(["ask me", "model says"]));
  expect(screen.getByText("Door")).toBeTruthy();
  expect(screen.getByText("decision-maker")).toBeTruthy();
  app.handlers["message.drop"] = () => note(3, "ask me");
  fireEvent.click(screen.getByRole("button", { name: "Remove note: ask me" }));
  expect(app.calls.filter((call) => call.method === "message.drop").map((call) => call.params)).toEqual([{ id: 3 }]);
  app.emit(sent(note(3, "ask me", { from: DOOR, status: "dropped" })));
  await waitFor(() => expect(rowsOf()).toEqual(["model says"]));
});

it("u3783_allow_delivers_one_and_resume_leaves_ask_first_rows", async () => {
  const { app, connected } = await mount([
    note(1, "ask me", { from: DOOR, status: "held", reason: "ask-first" }),
    note(2, "mine", { status: "held", reason: "takeover" }),
  ]);

  fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
  await waitFor(() => expect(connected.takeover.taken()).toBe("a"));
  expect(rowsOf()).toEqual(["ask me", "mine"]);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(connected.takeover.taken()).toBeNull());
  app.emit(sent(note(2, "mine", { status: "delivered" })));
  await waitFor(() => expect(document.querySelector('[data-note="2"]')?.getAttribute("data-state")).toBe("taken"));
  fireEvent.transitionEnd(document.querySelector('[data-note="2"]')!);
  await waitFor(() => expect(rowsOf()).toEqual(["ask me"]));
  expect(app.calls.filter((call) => call.method === "message.deliver")).toEqual([]);

  app.handlers["message.deliver"] = () => { throw new RpcError(-32000, "the inbox is unusable"); };

  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect(await screen.findByText("the inbox is unusable")).toBeTruthy();
  expect(rowsOf()).toEqual(["ask me"]);
  expect(app.calls.filter((call) => call.method === "message.deliver").map((call) => call.params)).toEqual([{ id: 1 }]);
});

it("u3783_takeover_held_agent_messages_stay_in_the_queue", async () => {
  const message = note(1, "wait for control", { from: DOOR, status: "held", reason: "takeover" });
  const { app } = await mount([message]);

  await waitFor(() => expect(rowsOf()).toEqual([message.body]));
  app.emit(sent({ ...message, status: "delivered", reason: null }));
  await waitFor(() => expect(document.querySelector('[data-note="1"]')?.getAttribute("data-state")).toBe("taken"));
  fireEvent.transitionEnd(document.querySelector('[data-note="1"]')!);
  await waitFor(() => expect(rowsOf()).toEqual([]));
});
