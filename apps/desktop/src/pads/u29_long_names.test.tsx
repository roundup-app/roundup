import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const LONG = "a-pad-with-a-very-long-name-here-ok";

describe("u29 long names", () => {
  // U2749 retires native titles: the name owns the full text through the shared Tooltip.
  it("u29_a_long_pad_name_keeps_its_owner_and_full_tooltip", async () => {
    await openShelf([padOf(LONG, USER)]);
    const name = await screen.findByText(LONG);
    const row = name.closest("[data-shelf-row]");

    expect(row?.contains(screen.getByRole("img", { name: "User owned" }))).toBe(true);
    fireEvent.pointerMove(name, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe(LONG);
  });
});
