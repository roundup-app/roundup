import { batch } from "solid-js";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo } from "../todos/testHarness";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";
import { stubDialogLayout } from "./bulkQuestionHarness";

afterEach(() => batch(cleanup));

stubDialogLayout();

const strand = (row: HTMLElement) => {
  fireEvent.click(row);
  row.blur();
  expect(document.activeElement).toBe(document.body);
};

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init });

it("u6829a_row_keys_work_when_a_click_leaves_focus_on_body (pad e opens the save chooser)", async () => {
  const { app } = await openShelf([padOf("a", AGENT), padOf("b", AGENT)]);
  strand(await screen.findByRole("button", { name: "a" }));
  press("e", { metaKey: true });
  press("e", { repeat: true });
  expect(app.chooser.suggestedNames).toEqual([]);
  press("e");
  await waitFor(() => expect(app.chooser.suggestedNames).toEqual(["a.md"]));
});

it("u6829a_row_keys_work_when_a_click_leaves_focus_on_body (pad d asks once, ArrowDown moves)", async () => {
  const { app } = await openShelf([padOf("a", AGENT), padOf("b", AGENT)]);
  strand(await screen.findByRole("button", { name: "a" }));
  press("ArrowDown");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "b" }));
  strand(screen.getByRole("button", { name: "a" }));
  press("d");
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.delete")).toHaveLength(1));
});

it("u6829a_row_keys_work_when_a_click_leaves_focus_on_body (todo d asks, e is inert, nothing clicked does nothing)", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  press("d");
  expect(app.calls.filter(call => call.method === "todo.delete")).toEqual([]);
  strand(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }));
  press("e");
  expect(app.chooser.suggestedNames).toEqual([]);
  press("d");
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.delete")).toHaveLength(1));
});
