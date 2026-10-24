import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { node, info } from "../testing/nodes";
import { mountNotes, note, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const mount = async (nodes = [node("a", { name: "Ann" })], messages = [note(1, "first"), note(2, "second")]) => {
  const mounted = await mountNotes(nodes, [info("t-a")], messages);

  mounted.connected.rail.select("a");
  await screen.findByText("t-a");

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

  app.handlers["message.drop"] = () => { throw new RpcError(-32000, "message 3 is already sent"); };

  fireEvent.click(screen.getByRole("button", { name: "Remove note: third" }));
  expect(await screen.findByText("message 3 is already sent")).toBeTruthy();
  app.emit(sent(note(3, "third", { status: "delivered" })));
  await waitFor(() => expect(rowsOf()).toEqual(["second"]));
});

it("u3782_removing_the_last_row_moves_focus_to_the_terminal", async () => {
  const { app } = await mount(undefined, [note(1, "only")]);

  app.handlers["message.drop"] = () => note(1, "only", { status: "dropped", reason: "removed" });
  fireEvent.click(await screen.findByRole("button", { name: "Remove note: only" }));
  app.emit(sent(note(1, "only", { status: "dropped", reason: "removed" })));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByText("t-a")));
});
