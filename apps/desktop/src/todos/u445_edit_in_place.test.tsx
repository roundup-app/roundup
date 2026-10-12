import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const drawer = () => screen.getByRole("complementary", { name: "drawer" });

const FONT = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "text-align", "white-space", "overflow-wrap", "padding", "margin", "border-top-width", "border-left-width"] as const;

const typeOf = (element: Element) => FONT.map((property) => getComputedStyle(element).getPropertyValue(property)).map((value) => (value === "0" ? "0px" : value === "" ? "start" : value));

const open = async () => {
  await mountTodos([todo(5, { title: "t".repeat(300), body: "one\ntwo" })], true);
  fireEvent.click(await screen.findByRole("button", { name: /#5/ }));
  await within(drawer()).findByText("one two", { exact: false }).catch(() => undefined);
};

describe("u445 edit in place", () => {
  it("u445_title_field_matches_shown_title", async () => {
    await open();
    const shown = within(drawer()).getByText("t".repeat(300));
    const before = typeOf(shown);
    fireEvent.dblClick(shown);
    const field = within(drawer()).getByRole("textbox", { name: "title" });

    expect(typeOf(field)).toEqual(before);
  });

  it("u445_body_field_matches_shown_body", async () => {
    await open();
    const shown = within(drawer()).getByText((_, element) => element?.tagName === "P" && element.textContent === "one\ntwo");
    const before = typeOf(shown);
    fireEvent.dblClick(shown);

    expect(typeOf(within(drawer()).getByRole("textbox", { name: "body" }))).toEqual(before);
  });

  it("u445_a_long_title_wraps_as_shown", async () => {
    await open();
    fireEvent.dblClick(within(drawer()).getByText("t".repeat(300)));
    const field = within(drawer()).getByRole<HTMLTextAreaElement>("textbox", { name: "title" });

    expect(getComputedStyle(field).overflow).toBe("hidden");
    expect(getComputedStyle(field).whiteSpace).toBe("pre-wrap");
    fireEvent.input(field, { target: { value: "a\nb" } });
    expect(field.value).toBe("a b");
  });

  it("u445_the_focus_mark_is_a_wash_and_changes_no_box", async () => {
    await open();
    fireEvent.dblClick(within(drawer()).getByText("t".repeat(300)));
    const field = within(drawer()).getByRole("textbox", { name: "title" });
    const style = getComputedStyle(field);

    expect(field.style.background).toBe("var(--hover)");
    expect(field.style.caretColor).toBe("var(--accent)");
    expect(style.outlineStyle).toBe("none");
    expect(style.borderTopWidth).toBe("0px");
  });

  it("u445_an_empty_body_keeps_its_line", async () => {
    await mountTodos([todo(5, { title: "x", body: "" })], true);
    fireEvent.click(await screen.findByRole("button", { name: /#5/ }));
    fireEvent.dblClick(await within(drawer()).findByText("no body"));

    expect(within(drawer()).getByRole("textbox", { name: "body" }).style.minHeight).toBe("1.4em");
  });
});
