import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NAME = `payments workstream ${"with a very long tail ".repeat(3)}`.trim();

/** jsdom has no layout: a `.name` box 100 wide holds as many characters as it has text length. */
const layout = (width: number) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(width);
};

const nameOf = (name: string) => rowOf(name).querySelector<HTMLElement>(".name")!;

it("u2228a_a_truncated_workstream_name_has_its_full_text", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME })]);

  await waitFor(() => expect(nameOf(NAME).title).toBe(NAME));
  expect(nameOf(NAME).textContent).toBe(NAME);
});

it("u2228a_a_name_that_fits_has_no_tooltip", async () => {
  layout(50);
  await mountRail([workstream("w", { name: NAME })]);

  await Promise.resolve();
  expect(nameOf(NAME).hasAttribute("title")).toBe(false);
});

it("u2228a_the_add_agent_tooltip_stays", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME })]);

  await waitFor(() => expect(nameOf(NAME).title).toBe(NAME));
  const add = rowOf(NAME).querySelector<HTMLElement>(".rail-add-label")!.closest("button")!;
  expect(add.title).not.toBe(NAME);
  expect(add.title).not.toBe("");
});
