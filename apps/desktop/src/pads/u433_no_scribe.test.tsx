import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";

afterEach(cleanup);

describe("u433 no Scribe", () => {
  it("u433_no_ask_field_no_exchange_no_read_line", async () => {
    const { calls } = await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");

    expect(screen.queryByLabelText("Ask or edit this pad")).toBeNull();
    expect(document.querySelector(".pad-exchange")).toBeNull();
    expect(screen.getByLabelText("Drawer").textContent).not.toContain("You read · ");
    expect(calls()).not.toContain("pad.ask");
  });
});
