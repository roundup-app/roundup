import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

describe("u139 a non-Enter key on the focused text does not start editing", () => {
  it("u139_a_non_enter_key_on_the_title_does_not_start_editing", async () => {
    await mountTodos([todo(5, { title: "session store", body: "Move the cache." })]);
    { const focusedRow = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #5 / }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }

    await within(drawer()).findByRole("button", { name: /^Blocked by/ });
    const title = within(drawer()).getByText("session store", { selector: ":not(.todo-breadcrumb-title)" });

    const fields = within(drawer()).queryAllByRole("textbox");
    title.focus();
    fireEvent.keyDown(title, { key: "a" });

    expect(within(drawer()).queryAllByRole("textbox")).toEqual(fields);
  });
});
