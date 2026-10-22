import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, info } from "../testing/nodes";
import { mountNotes, note, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const mount = async (reduced = false, messages = [note(1, "first"), note(2, "second"), note(3, "third")]) => {
  const mounted = await mountNotes([agent("a", "working", "Reading Thread.tsx", { name: "Ann" })], [info("t-a")], messages, reduced);

  mounted.connected.rail.select("a");
  await screen.findByRole("textbox", { name: "Note to Ann" });
  await waitFor(() => expect(rowsOf()).toHaveLength(messages.length));

  return mounted;
};

const stateOf = (id: number) => document.querySelector(`[data-note="${id}"]`)?.getAttribute("data-state");

it("u3784_a_taken_note_glides_once_and_a_mount_plays_nothing", async () => {
  const { app } = await mount();

  expect([1, 2, 3].map(stateOf)).toEqual(["waiting", "waiting", "waiting"]);
  expect(screen.getByText("Now: Reading Thread.tsx")).toBeTruthy();

  app.emit(sent(note(1, "first", { status: "delivered" })));
  await waitFor(() => expect(stateOf(1)).toBe("taken"));
  await waitFor(() => expect(document.querySelector('[data-note="2"]')?.hasAttribute("data-closing")).toBe(true));

  fireEvent.transitionEnd(document.querySelector('[data-note="1"]')!);
  await waitFor(() => expect(rowsOf()).toEqual(["second", "third"]));
  expect(stateOf(2)).toBe("waiting");
  expect(document.querySelector('[data-note="2"]')?.hasAttribute("data-closing")).toBe(false);
});

it("u3784_a_batch_glides_together_and_a_removal_does_not", async () => {
  const { app } = await mount();

  app.emit(sent(note(1, "first", { status: "delivered" })));
  app.emit(sent(note(2, "second", { status: "delivered" })));
  await waitFor(() => expect([stateOf(1), stateOf(2), stateOf(3)]).toEqual(["taken", "taken", "waiting"]));

  app.emit(sent(note(3, "third", { status: "dropped", reason: "removed" })));
  await waitFor(() => expect(rowsOf()).toEqual(["first", "second"]));
  expect([stateOf(1), stateOf(2)]).toEqual(["taken", "taken"]);
});

it("u3784_reduced_motion_removes_the_row_with_no_transition", async () => {
  const { app } = await mount(true);

  app.emit(sent(note(1, "first", { status: "delivered" })));
  await waitFor(() => expect(rowsOf()).toEqual(["second", "third"]));
  expect(document.querySelector('[data-state="taken"]')).toBeNull();
});
