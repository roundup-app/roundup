import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { withScopeRow } from "../testing/showEverything";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";

afterEach(cleanup);

const head = () => document.querySelector<HTMLElement>(".pad-head")!;

describe("u431 the Drawer's head", () => {
  it("u431_head_holds_name_and_icons_in_order", async () => {
    const { app, connected } = await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");
    app.handlers["rail.tree"] = () => withScopeRow([agent("agent-7f3", "working", "editing", { name: "auth-refactor" })]);
    await connected.rail.refresh();

    const buttons = within(head()).getAllByRole("button");

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["make yours", "open owner", "export .md", "delete"]);
    expect(head().querySelector(".pad-head-name")!.textContent).toBe("auth-notes");
  });

  it("u431_icons_have_a_title_and_no_visible_word", async () => {
    await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");

    for (const label of ["export .md", "delete"]) {
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

    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    expect(calls()).not.toContain("pad.delete");

    fireEvent.click(await screen.findByRole("button", { name: "delete" }));
    await waitFor(() => expect(calls()).toContain("pad.delete"));
  });

  it("u431_toolbar_buttons_have_a_title", async () => {
    await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");

    const bar = document.querySelector(".milkdown-top-bar");

    expect(bar).not.toBeNull();
  });
});
