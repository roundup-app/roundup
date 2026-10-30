import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "./owner";

afterEach(cleanup);

describe("u431 the Drawer's head", () => {
  // U21’s chooser/export tests and u150_confirming_calls_pad_delete_once_closes_with_no_deleted_line
  // retain the document-action proof formerly repeated here (rule 10).
  it("u431_toolbar_is_one_row_with_titles", async () => {
    await openShelf([padOf("auth-notes", USER, "x")]);
    await openPad("auth-notes");

    const buttons = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLButtonElement>(".milkdown-top-bar .top-bar-item, .milkdown-top-bar .top-bar-heading-button")];

      expect(found.length).toBeGreaterThan(0);

      return found;
    });

    // The one-row layout itself is measured in the real-browser harness: the observe.sh of U431.
    expect(buttons.filter((button) => !button.title)).toEqual([]);
    // Titles may also teach the registered chord; U431 requires an action title, not exact label equality.
  });
});
