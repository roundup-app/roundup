import { cleanup, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { event, info } from "../testing/nodes";
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

it.each([
  [true, null, "Running"],
  [false, 7, "Exit 7"],
  [false, null, "Exit signal"],
] as const)("u471_previous_copy_assertions_are_preserved_bubble_status_uses_sentence_case_%s_%s", async (running, exit_code, label) => {
  await mountBubbles("a", [info("1", { owner: "a", running, exit_code })]);

  expect((await screen.findAllByRole("img", { name: label })).length).toBeGreaterThan(0);
});

it("u471_previous_copy_assertions_are_preserved_bubble_signal_exit_uses_sentence_case", async () => {
  const mounted = await mountBubbles("a", [info("1", { owner: "a" })]);

  mounted.app.emit(event({ name: "terminal.exited", data: { id: "1", code: null } }));
  await waitFor(() => expect(screen.getAllByRole("img", { name: "Exit signal" }).length).toBeGreaterThan(0));
});

it("u471_previous_copy_assertions_are_preserved_bubble_program_titles_stay_as_written", async () => {
  await mountBubbles("a", [info("1", { owner: "a", title: "cargo test --all" })]);

  expect(await screen.findByRole("group", { name: "cargo test --all" })).toBeTruthy();
  expect(screen.getAllByText("cargo test --all")).toHaveLength(2);
});
