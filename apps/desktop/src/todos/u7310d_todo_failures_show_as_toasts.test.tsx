import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { notice, notices } from "../testing/notices";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const toasts = () => screen.getByRole("region", { name: "Updates" });

// The Drawer's failure or blank lines; the comments' screen-reader announcer takes no space, and a status (the kept draft) holds its text.
const messageLines = () => [...panel().querySelectorAll(".reserved-line:not([aria-live]):not([role=status])")];

it("u7310d_todo_failures_show_as_toasts", async () => {
  const m = await mountTodos([todo(1)]);
  const row = await screen.findByRole("button", { name: /^Idle #1 / });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await within(panel()).findByRole("region", { name: "Activity" });
  expect(messageLines()).toEqual([]);
  const field = within(panel()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  m.app.handlers["todo.comment"] = () => Promise.reject(new RpcError(-32003, "Daemon said no"));
  fireEvent.input(field, { target: { value: "keep me" } });
  fireEvent.click(within(panel()).getByRole("button", { name: "Comment" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.comment")).toHaveLength(1));

  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(messageLines()).toEqual([]);
  expect(field.value).toBe("keep me");

  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(shown.isConnected).toBe(false));
  expect(notices("alert")).toEqual([]);
  expect(messageLines()).toEqual([]);
});
