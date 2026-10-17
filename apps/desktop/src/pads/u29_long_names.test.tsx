import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const LONG = "a-pad-with-a-very-long-name-here-ok";

describe("u29 long names", () => {
  // U359 supersedes "one line" for the Shelf: a name shows two lines and then `…`; the row's `title` holds the whole name.
  it("u29_a_long_pad_name_keeps_the_mark_and_the_name_in_one_row_and_clamps_at_two_lines", async () => {
    await openShelf([padOf(LONG, USER)]);
    const name = await screen.findByText(LONG);
    const row = name.closest("[data-shelf-row]");

    expect(row?.contains(screen.getByRole("img", { name: "User owned" }))).toBe(true);
    expect(name.closest("button")?.title).toBe(LONG);
  });
});
