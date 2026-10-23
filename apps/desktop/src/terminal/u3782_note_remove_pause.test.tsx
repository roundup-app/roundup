import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, node, info } from "../testing/nodes";
import { mountNotes, note, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const mount = async (nodes = [node("a", { name: "Ann" })], messages = [note(1, "first"), note(2, "second")]) => {
  const mounted = await mountNotes(nodes, [info("t-a")], messages);

  mounted.connected.rail.select("a");
  await screen.findByRole("textbox", { name: "Note to Ann" });

  return mounted;
};

const calls = (app: Awaited<ReturnType<typeof mount>>["app"], ...methods: string[]) => app.calls.filter((call) => methods.includes(call.method));

it("u3782_remove_drops_one_message_and_keeps_the_rest", async () => {
  const { app } = await mount(undefined, [note(1, "first"), note(2, "second"), note(3, "third")]);

  app.handlers["message.drop"] = () => note(1, "first", { status: "dropped", reason: "removed" });
  await waitFor(() => expect(rowsOf()).toEqual(["first", "second", "third"]));
  fireEvent.click(screen.getByRole("button", { name: "Remove note: first" }));
  expect(calls(app, "message.drop").map((call) => call.params)).toEqual([{ id: 1 }]);
  expect(rowsOf()).toEqual(["first", "second", "third"]);

  app.emit(sent(note(1, "first", { status: "dropped", reason: "removed" })));
  await waitFor(() => expect(rowsOf()).toEqual(["second", "third"]));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove note: second" })));

  app.handlers["message.drop"] = () => { throw new RpcError(-32000, "message 3 is not held"); };

  fireEvent.click(screen.getByRole("button", { name: "Remove note: third" }));
  expect(await screen.findByText("message 3 is not held")).toBeTruthy();
  app.emit(sent(note(3, "third", { status: "delivered" })));
  await waitFor(() => expect(document.querySelector('[data-note="3"]')?.getAttribute("data-state")).toBe("taken"));
  fireEvent.transitionEnd(document.querySelector('[data-note="3"]')!);
  await waitFor(() => expect(rowsOf()).toEqual(["second"]));
});

it("u3782_removing_the_last_row_moves_focus_to_the_field", async () => {
  const { app } = await mount(undefined, [note(1, "only")]);

  app.handlers["message.drop"] = () => note(1, "only", { status: "dropped", reason: "removed" });
  fireEvent.click(await screen.findByRole("button", { name: "Remove note: only" }));
  app.emit(sent(note(1, "only", { status: "dropped", reason: "removed" })));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Note to Ann" })));
});

it("u3782_pause_and_resume_are_takeover_and_show_its_state", async () => {
  const { app, connected } = await mount();

  fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
  await waitFor(() => expect(connected.takeover.taken()).toBe("a"));
  expect(calls(app, "takeover.begin").map((call) => call.params)).toEqual([{ agent: "a" }]);
  expect(screen.getByText("Paused")).toBeTruthy();
  expect(screen.getByText("You control")).toBeTruthy();
  expect(rowsOf()).toEqual(["first", "second"]);

  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(connected.takeover.taken()).toBeNull());
  expect(calls(app, "takeover.end").map((call) => call.params)).toEqual([{ agent: "a" }]);

  app.handlers["takeover.begin"] = () => { throw new RpcError(-32000, "cannot pause"); };

  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(await screen.findByText("cannot pause")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

it("u3782_pause_stops_no_turn_and_is_absent_for_a_finished_agent", async () => {
  const { app } = await mount();

  fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
  await waitFor(() => expect(calls(app, "takeover.begin")).toHaveLength(1));
  expect(calls(app, "agent.interrupt")).toEqual([]);
  cleanup();

  await mount([agent("a", "done", "finished", { name: "Ann" })]);
  expect(screen.queryByRole("button", { name: /^(Pause|Resume)$/ })).toBeNull();
});
