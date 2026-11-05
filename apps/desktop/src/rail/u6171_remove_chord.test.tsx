import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { registerKeys } from "../keys/registry";
import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { agent } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const REMOVE = { key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true };

const CMD_BACKSPACE = { key: "Backspace", code: "Backspace", metaKey: true };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const mount = async () => {
  const mounted = await mountRail([agent("a", "idle", "x"), agent("b", "idle", "x")]);
  mounted.app.handlers["rail.remove"] = () => null;

  return mounted;
};

/** A stand-in for the focused Terminal's input, recording what reaches it. */
const terminalInput = () => {
  const input = document.body.appendChild(document.createElement("textarea"));
  const reached: KeyboardEvent[] = [];

  input.className = "xterm-helper-textarea";
  input.addEventListener("keydown", press => reached.push(press));
  input.focus();

  return { input, reached };
};

it("u6171a_remove_chord_removes_the_selected_item_from_a_focused_terminal", async () => {
  const { app, rail } = await mount();
  rail.select("a");
  const { input } = terminalInput();

  fireEvent.keyDown(input, REMOVE);
  await answerQuestion(true);

  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "a" }]));
  expect(app.calls.some(call => call.method === "terminal.write")).toBe(false);
  input.remove();
});

it.each(["a row", "elsewhere"])("u6171a_remove_chord_runs_from_a_row_and_from_elsewhere: %s", async place => {
  const { app, rail } = await mount();
  rail.select("a");

  if (place === "a row") rowOf("a").focus();
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

  fireEvent.keyDown(place === "a row" ? rowOf("a") : document.body, REMOVE);
  await answerQuestion(true);
  await waitFor(() => expect(railCallsTo(app, "rail.remove")).toEqual([{ id: "a" }]));
});

it("u6171b_cmd_backspace_removes_nothing_and_reaches_the_terminal_as_ctrl_u", async () => {
  const { app, rail } = await mount();
  rail.select("a");
  rowOf("a").focus();
  fireEvent.keyDown(rowOf("a"), CMD_BACKSPACE);

  const { input, reached } = terminalInput();
  const press = new KeyboardEvent("keydown", { ...CMD_BACKSPACE, bubbles: true, cancelable: true });
  input.dispatchEvent(press);
  await tick();

  expect(railCallsTo(app, "rail.remove")).toEqual([]);
  expect(press.defaultPrevented).toBe(false);
  expect(reached).toHaveLength(1);
  input.remove();
});

it("u6171a_remove_chord_with_nothing_selected_or_a_dialog_open_calls_nothing", async () => {
  const { app, rail } = await mount();
  const [open, setOpen] = createSignal(false);
  registerKeys({ kind: "layer", element: () => undefined, active: open, modal: true }, []);

  fireEvent.keyDown(document.body, REMOVE);
  await tick();
  expect(railCallsTo(app, "rail.remove")).toEqual([]);

  rail.select("a");
  setOpen(true);
  fireEvent.keyDown(document.body, REMOVE);
  await tick();
  expect(railCallsTo(app, "rail.remove")).toEqual([]);
});

