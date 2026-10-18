import { cleanup, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { info } from "../testing/nodes";
import { mountBubbles } from "./bubblesFixture";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

it("u471_previous_copy_assertions_are_preserved_bubble_controls_use_sentence_case", async () => {
  await mountBubbles("a", [info("1", { owner: "a", title: "cargo test" })]);
  const bubble = await screen.findByRole("group", { name: "cargo test" });

  expect(within(bubble).queryByRole("slider")).toBeNull();
  expect(within(bubble).getByRole("button", { name: "Minimise" })).toBeTruthy();
  expect(within(bubble).getByRole("button", { name: "Close" })).toBeTruthy();
});

it("u471_previous_copy_assertions_are_preserved_bubble_program_titles_stay_as_written", async () => {
  await mountBubbles("a", [info("1", { owner: "a", title: "cargo test --all" })]);

  expect(await screen.findByRole("group", { name: "cargo test --all" })).toBeTruthy();
  expect(screen.getAllByText("cargo test --all")).toHaveLength(2);
});
