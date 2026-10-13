import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

// U461 removes the Todo Drawer's Home line, including its live name updates.
it.each(["r1", "unknown", null])("u158_the_drawer_omits_home_%s", async (home) => {
  await mountTodos([todo(2, { home })], true, [workstream("r1", { name: "alpha" })]);

  fireEvent.click(await screen.findByRole("button", { name: /#2/ }));
  const panel = within(screen.getByRole("complementary", { name: "Drawer" }));
  await panel.findByText("Blocker");

  expect(panel.queryByText(/^In /)).toBeNull();
  expect(panel.queryByText("alpha")).toBeNull();
  expect(panel.queryByText("unknown")).toBeNull();
});
