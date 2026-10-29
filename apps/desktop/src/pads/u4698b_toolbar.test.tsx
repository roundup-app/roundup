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
    ["Bold", "**word**"],
    ["Italic", "*word*"],
    ["Inline code", "`word`"],
    ["Bullet list", "- word"],
    ["Numbered list", "1. word"],
    ["Checklist", "- [ ] word"],
    ["Quote", "> word"],
    ["Code block", "```\nword\n```"],
  ])("u4698b_%s_edits_the_selection_and_saves_markdown", async (name, saved) => {
    const { app } = await openShelf([padOf("note", USER, "word")]);
    const field = await openPad("note");

    field.setSelectionRange(1, 5, "forward");
    fireEvent.pointerDown(screen.getByRole("button", { name }));
    fireEvent.focusOut(field);

    await waitFor(() => expect(writes(app.calls)).toHaveLength(1));
    // SAFETY: pad.write params carry the saved Markdown as `text`.
    expect((writes(app.calls)[0]?.params as { text: string }).text.trim()).toBe(saved);
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
