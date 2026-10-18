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
