import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const writes = (calls: { method: string; params?: unknown }[]) => calls.filter((call) => call.method === "pad.write");

const FORMATS = ["Bold", "Italic", "Inline code", "Link", "Bullet list", "Numbered list", "Checklist", "Heading", "Quote", "Code block", "Table"];

const toolbar = () => [...document.querySelectorAll<HTMLElement>(".milkdown-top-bar .top-bar-item, .milkdown-top-bar .top-bar-heading-button")].map((button) => button.getAttribute("aria-label"));

describe("u4698b the Pad toolbar is exactly the eleven formats", () => {
  it("u4698b_toolbar_has_exactly_the_eleven_formats", async () => {
    await openShelf([padOf("note", USER, "word")]);
    await openPad("note");

    expect(toolbar().sort()).toEqual([...FORMATS].sort());
  });

  it.each([
    ["Bold", "**word**", "strong"],
    ["Italic", "*word*", "em"],
    ["Inline code", "`word`", "p code"],
    ["Bullet list", "- word", "ul li"],
    ["Numbered list", "1. word", "ol li"],
    ["Checklist", "- [ ] word", "li[data-item-type=task]"],
    ["Quote", "> word", "blockquote"],
    ["Code block", "```\nword\n```", "pre code"],
    ["Link", "[word](https://example.com/)", "a[href=\"https://example.com/\"]"],
    ["Heading", "# word", "h1"],
    ["Table", null, "table"],
  ])("u4698b_toolbar_edits_and_reopens_each_format: Pad %s", async (name, saved, semantic) => {
    const { app, connected, state } = await openShelf([padOf("note", USER, "word")]);
    const field = await openPad("note");

    field.setSelectionRange(1, 5, "forward");
    fireEvent.pointerDown(screen.getByRole("button", { name }));
    if (name === "Heading") fireEvent.pointerDown(await screen.findByRole("button", { name: "Heading 1" }));

    if (name === "Link") {
      const input = await screen.findByPlaceholderText("Paste link...");
      fireEvent.input(input, { target: { value: "https://example.com/" } });
      fireEvent.keyDown(input, { key: "Enter" });
    }

    await waitFor(() => expect(field.querySelector(semantic)).not.toBeNull());
    fireEvent.focusOut(field);

    await waitFor(() => expect(writes(app.calls)).toHaveLength(1));
    // SAFETY: pad.write params carry the saved Markdown as `text`.
    const source = (writes(app.calls)[0]!.params as { text: string }).text.trim();

    if (saved) expect(source).toBe(saved);
    else expect(source).toContain("| --- | --- | --- |");

    await waitFor(() => expect(state.pads[0]?.text.trim()).toBe(source));
    connected.drawer.close();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Pad body" })).toBeNull());
    const reopened = await openPad("note");

    expect(reopened.querySelector(semantic)).not.toBeNull();
    expect(reopened.value.trim()).toBe(source);
  });

  it("u4698b_read_only_toolbar_cannot_write", async () => {
    const { app } = await openShelf([padOf("note", AGENT, "word")]);
    const field = await openPad("note");

    expect(field.readOnly).toBe(true);
    expect(document.querySelector(".pad-readonly .milkdown-top-bar")).not.toBeNull();

    for (const button of document.querySelectorAll<HTMLElement>(".milkdown-top-bar .top-bar-item")) fireEvent.click(button);

    fireEvent.focusOut(field);

    await new Promise((done) => setTimeout(done, 50));
    expect(writes(app.calls)).toHaveLength(0);
    expect(field.value).toBe("word");
  });
});
