import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { info } from "../testing/nodes";
import { mountBubbles } from "./bubblesFixture";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

it("u471_previous_copy_assertions_are_preserved_bubble_program_titles_stay_as_written", async () => {
  await mountBubbles("a", [info("1", { owner: "a", title: "cargo test --all" })]);

  expect(await screen.findByRole("group", { name: "cargo test --all" })).toBeTruthy();
  expect(screen.getAllByText("cargo test --all")).toHaveLength(2);
});
