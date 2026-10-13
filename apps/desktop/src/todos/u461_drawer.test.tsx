import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async () => {
  const mounted = await mountTodos([todo(1, { title: "Ship", body: "Read this\nThen this" })]);
  fireEvent.click(await screen.findByRole("button", { name: "Idle #1 Ship" }));
  await within(panel()).findByText("Blocker");

  return mounted;
};

it("u461_header_and_content_have_the_requested_hierarchy", async () => {
  await open();
  const box = within(panel()).getByRole<HTMLInputElement>("checkbox", { name: "Complete Ship" });
  const title = within(panel()).getByText("Ship");
  expect(box.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(box.classList.contains("todo-tick")).toBe(true);
  expect(within(panel()).getByRole("button", { name: "Delete Todo" }).querySelector("svg")).toBeTruthy();

  for (const text of ["#1", "Created by", "Last", "In Project root", "Move", "Complete"]) expect(panel().textContent).not.toContain(text);
});

it("u461_completion_failure_keeps_focus", async () => {
  const { app } = await open();
  app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32003, "Try again"));
  const box = within(panel()).getByRole<HTMLInputElement>("checkbox", { name: "Complete Ship" });
  box.focus(); fireEvent.click(box);
  await within(panel()).findByText("Try again");
  expect(box.checked).toBe(false); expect(document.activeElement).toBe(box);
});

it("u461_completion_success_keeps_drawer_focus", async () => {
  const { app, store } = await open();
  const box = within(panel()).getByRole<HTMLInputElement>("checkbox", { name: "Complete Ship" });
  box.focus(); fireEvent.click(box);
  await waitFor(() => expect(todoCallsTo(app, "todo.complete")).toHaveLength(1));
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await waitFor(() => expect((box).checked).toBe(true));
  expect(panel().contains(document.activeElement)).toBe(true);
});

it("u461_keep_and_escape_restore_focus", async () => {
  const { app } = await open();
  const button = within(panel()).getByRole("button", { name: "Delete Todo" });
  fireEvent.click(button); await within(panel()).findByRole("button", { name: "Keep" });
  fireEvent.keyDown(document.activeElement!, { key: "Escape", bubbles: true });
  await waitFor(() => expect(document.activeElement).toBe(button));
  expect(within(panel()).queryByRole("button", { name: "Keep" })).toBeNull();
  expect(todoCallsTo(app, "todo.delete")).toHaveLength(0);
});
