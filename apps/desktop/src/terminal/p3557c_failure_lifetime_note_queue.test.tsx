import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { node, info } from "../testing/nodes";
import { mountNotes, note, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const AGENTS = [node("a", { name: "Ann" }), node("b", { name: "Bo" })];

const TERMINALS = [info("t-a"), info("t-b")];

const REFUSED = "Daemon refused";

const alert = () => screen.queryByRole("alert", { name: REFUSED });

const remove = (container: Element, id: number) => fireEvent.click(container.querySelector(`[data-note="${id}"] [data-remove]`)!);

it.each(["failed deletion", "dismissal", "acknowledged deletion", "unrelated deletion"] as const)("p3557c_failure_lifetime_note_queue_%s", async (action) => {
  const { app, connected, container } = await mountNotes(AGENTS, TERMINALS, [note(1, "first"), note(2, "second"), note(3, "for Bo", { to: "b" })]);

  connected.rail.select("a");
  await waitFor(() => expect(rowsOf()).toEqual(["first", "second"]));

  app.handlers["message.drop"] = () => { throw new Error(REFUSED); };

  remove(container, 1);

  await screen.findByRole("alert", { name: REFUSED });

  expect(rowsOf()).toEqual(["first", "second"]);

  const calls = app.calls.length;

  if (action === "dismissal") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

  if (action === "acknowledged deletion") app.emit(sent(note(1, "first", { status: "dropped", reason: "removed" })));

  if (action === "unrelated deletion") app.emit(sent(note(2, "second", { status: "dropped", reason: "removed" })));

  await waitFor(() => expect(rowsOf()).toEqual(action === "acknowledged deletion" ? ["second"] : action === "unrelated deletion" ? ["first"] : ["first", "second"]));
  expect(alert() === null).toBe(action === "dismissal" || action === "acknowledged deletion");

  if (action === "dismissal") expect(app.calls.length).toBe(calls);

  // the other Agent never shows or inherits the line
  connected.rail.select("b");
  await waitFor(() => expect(rowsOf()).toEqual(["for Bo"]));
  expect(alert()).toBeNull();
});
