import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);
stubDialogLayout();

it("u4698d_header_navigates_the_visible_order_without_mutating", async () => {
  const { app } = await mountTodos([todo(7), todo(3), todo(9)]);
  fireEvent.keyDown(await screen.findByRole("button", { name: "Idle #3 todo 3" }), { key: "Enter" });
  const panel = screen.getByRole("complementary", { name: "Drawer" });
  fireEvent.click(await within(panel).findByRole("button", { name: "Previous Todo" }));
  await within(panel).findByRole("checkbox", { name: "Complete todo 7" });
  expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Previous Todo" }).disabled).toBe(true);
  fireEvent.click(within(panel).getByRole("button", { name: "Next Todo" }));
  await within(panel).findByRole("checkbox", { name: "Complete todo 3" });
  expect(todoCallsTo(app, "todo.update")).toEqual([]);
  expect(todoCallsTo(app, "todo.assign")).toEqual([]);
});
