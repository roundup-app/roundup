import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async (body: string, done = false) => {
  const mounted = await mountTodos([todo(1, { title: "Ship", body, done })]);

  if (done) fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
  { const focusedRow = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #\d+ Ship/ }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }
  await within(panel()).findByRole("button", { name: /^Blocked by/ });
  await within(panel()).findByRole("region", { name: "Todo history" });

  return mounted;
};


it("u3732_click_and_enter_open_the_body_with_focus", async () => {
  const { app } = await open("");
  fireEvent.click(within(panel()).getByRole("button", { name: "Add notes" }));
  const field = await within(panel()).findByRole("textbox", { name: "Body" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(field).toBeInstanceOf(HTMLTextAreaElement);
  expect(field instanceof HTMLTextAreaElement && field.selectionStart).toBe(0);
  expect(todoCallsTo(app, "todo.update")).toHaveLength(0);
});

it("u3732_escape_or_empty_leaves_add_notes_with_no_call", async () => {
  const { app } = await open("");
  fireEvent.click(within(panel()).getByRole("button", { name: "Add notes" }));
  const field = await within(panel()).findByRole("textbox", { name: "Body" });
  fireEvent.keyDown(field, { key: "Escape" });
  const button = await within(panel()).findByRole("button", { name: "Add notes" });
  await waitFor(() => expect(document.activeElement).toBe(button));
  expect(todoCallsTo(app, "todo.update")).toHaveLength(0);
});

it("u3732_committing_notes_calls_update_once", async () => {
  const { app } = await open("");
  fireEvent.click(within(panel()).getByRole("button", { name: "Add notes" }));
  const field = await within(panel()).findByRole("textbox", { name: "Body" });
  fireEvent.input(field, { target: { value: "remember this" } });
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(todoCallsTo(app, "todo.update")).toHaveLength(1));
  expect(todoCallsTo(app, "todo.update")[0]!.params).toMatchObject({ id: 1, title: null, body: "remember this" });
});
