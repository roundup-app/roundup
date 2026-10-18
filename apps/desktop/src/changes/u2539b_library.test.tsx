import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { treesLoaded } from "./ChangedTree";
import { mountControl } from "./harness";

afterEach(cleanup);

it("u2539b_the_library_loads_on_first_open", async () => {
  await mountControl();

  expect(treesLoaded()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));

  await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  expect(treesLoaded()).toBe(true);
});


it("u2539b_file_names_announce_status_old_path_and_deleted_action", async () => {
  await mountControl(() => ({ files: [
    { path: "new.ts", from: "old.ts", status: "renamed", line: 1 },
    { path: "gone.ts", status: "deleted", line: null },
  ] }));
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));

  await waitFor(() => {
    const root = document.querySelector("file-tree-container")?.shadowRoot;

    expect(root?.querySelector('[data-item-path="new.ts"]')?.getAttribute("aria-label")).toBe("new.ts, Renamed, old.ts → new.ts");
    expect(root?.querySelector('[data-item-path="gone.ts"]')?.getAttribute("aria-label")).toBe("gone.ts, Deleted, unavailable in editor");
  });
});
