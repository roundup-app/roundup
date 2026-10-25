import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { itemOf, mountRail, rowOf } from "./railFixture";

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

/** The row, not its name, carries the Tooltip trigger, so any point of it reaches it. */
const hoverRow = (name: string) => fireEvent.pointerMove(rowOf(name), { pointerType: "mouse" });

it("u2228a_a_truncated_workstream_name_has_its_full_text", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME }), agent("a", "idle", "working on it", { parent: "w", name: "agent long name" })]);

  const leaf = document.querySelector<HTMLElement>('.rail-row[data-id="a"]')!;

  await waitFor(() => expect(rowOf(NAME).getAttribute("title")).toBe(NAME));
  expect(leaf.getAttribute("title")).toBe("agent long name");
  expect(itemOf(NAME).getAttribute("aria-label")).toContain(NAME);
  expect(leaf.closest("[role=treeitem]")!.getAttribute("aria-label")).toBe("agent long name, working on it");
});

it("u2228a_a_name_that_fits_has_no_tooltip", async () => {
  layout(50);
  await mountRail([workstream("w", { name: NAME })]);

  await Promise.resolve();
  hoverRow(NAME);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(rowOf(NAME).hasAttribute("title")).toBe(false);
});

it("u2228c_a_row_opens_no_tooltip", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME }), agent("a", "idle", "working on it", { parent: "w" })]);

  for (const row of [rowOf(NAME), document.querySelector<HTMLElement>('.rail-row[data-id="a"]')!]) {
    fireEvent.pointerMove(row, { pointerType: "mouse" });
    fireEvent.click(row);
    row.focus();
  }

  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});
