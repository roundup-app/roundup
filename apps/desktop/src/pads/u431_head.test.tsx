import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { withScopeRow } from "../testing/showEverything";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "./owner";

afterEach(cleanup);

const head = () => document.querySelector<HTMLElement>(".pad-head")!;

describe("u431 the Drawer's head", () => {
  it("u431_head_holds_name_and_three_icons", async () => {
    const { app, connected } = await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");
    app.handlers["rail.tree"] = () => withScopeRow([agent("agent-7f3", "working", "editing", { name: "auth-refactor" })]);
    await connected.rail.refresh();

    const buttons = within(head()).getAllByRole("button");

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Make yours", "Open owner", "Export .md", "Delete"]);
    expect(head().querySelector(".pad-head-name")!.textContent).toBe("auth-notes");

    const close = screen.getByRole("button", { name: "close" });

    // `close` is the Drawer's own, drawn at its right edge after the head (measured in artifacts/ux/U431/observe.sh).
    expect(head().contains(close)).toBe(false);
    expect(close.closest("[aria-label=drawer]")).toBe(head().closest("[aria-label=drawer]"));
  });

  it("u431_icons_have_a_title_and_no_visible_word", async () => {
    await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");

    for (const label of ["Export .md", "Delete"]) {
      const button = screen.getByRole("button", { name: label });

      expect(button.getAttribute("title")).toBe(label);
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("u431_no_owned_by_text", async () => {
    await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");

    expect(screen.getByLabelText("drawer").textContent).not.toContain("owned by");
  });

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

    // The one-row layout itself is measured in the real-browser harness: artifacts/ux/U431/observe.sh.
    expect(buttons.filter((button) => !button.title)).toEqual([]);
    expect(buttons.filter((button) => button.title !== button.getAttribute("aria-label"))).toEqual([]);
  });
});
