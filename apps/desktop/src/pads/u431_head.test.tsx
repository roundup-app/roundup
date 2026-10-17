import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "./owner";

afterEach(cleanup);

describe("u431 the Drawer's head", () => {
  it("u431_delete_still_asks_once", async () => {
    const { calls } = await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(calls()).not.toContain("pad.delete");

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls()).toContain("pad.delete"));
  });

  it("u431_export_and_delete_keep_u21_and_u150", async () => {
    const { app, calls } = await openShelf([padOf("auth-notes", AGENT, "x")]);
    app.chooser.savePath = "/tmp/auth-notes.md";
    app.handlers["pad.export"] = () => null;
    await openPad("auth-notes");

    fireEvent.click(screen.getByRole("button", { name: "Export .md" }));
    await waitFor(() => expect(calls()).toContain("pad.export"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(calls()).not.toContain("pad.delete");
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("u431_toolbar_is_one_row_with_titles", async () => {
    await openShelf([padOf("auth-notes", USER, "x")]);
    await openPad("auth-notes");

    const buttons = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLButtonElement>(".milkdown-top-bar button")];

      expect(found.length).toBeGreaterThan(0);

      return found;
    });

    // The one-row layout itself is measured in the real-browser harness: the observe.sh of U431.
    expect(buttons.filter((button) => !button.title)).toEqual([]);
    expect(buttons.filter((button) => button.title !== button.getAttribute("aria-label"))).toEqual([]);
  });
});
