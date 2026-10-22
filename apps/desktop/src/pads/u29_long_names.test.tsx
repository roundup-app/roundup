import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const LONG = "a-pad-with-a-very-long-name-here-ok";

describe("u29 long names", () => {
  it("u29_a_long_pad_name_keeps_its_owner", async () => {
    await openShelf([padOf(LONG, USER)]);
    const name = await screen.findByText(LONG);
    const row = name.closest("[data-shelf-row]");

    expect(row?.contains(screen.getByRole("img", { name: "User owned" }))).toBe(true);
  });
});
