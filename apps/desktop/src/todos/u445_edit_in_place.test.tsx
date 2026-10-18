import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async () => {
  await mountTodos([todo(5, { title: "t".repeat(300), body: "one\ntwo" })], true);
  fireEvent.click(await screen.findByRole("button", { name: /#5/ }));
  await within(drawer()).findByText("one two", { exact: false }).catch(() => undefined);
};

describe("u445 edit in place", () => {
  it("u445_a_long_title_wraps_as_shown", async () => {
    await open();
    fireEvent.dblClick(within(drawer()).getByText("t".repeat(300)));
    const field = within(drawer()).getByRole<HTMLTextAreaElement>("textbox", { name: "Title" });

    fireEvent.input(field, { target: { value: "a\nb" } });
    expect(field.value).toBe("a b");
  });
});
