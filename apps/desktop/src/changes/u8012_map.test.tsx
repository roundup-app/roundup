import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { copy } from "./copy";
import { chooseLens, counted, landed, lensGroup, moduleKeys, press, region, setUpView, showViewedRows, showing, tabNamed } from "./viewHarness";

setUpView();

// U8012: the change map beside the list.

const FILES = [
  counted("crates/a/src/x.rs", 5, 1),
  counted("crates/b/src/y.rs", 7, 4),
  counted("crates/c/tests/z.rs", 2, 2),
  { ...counted("crates/d/src/w.rs", 0, 0), counts: null },
];

const map = () => within(screen.getByRole("group", { name: copy.changeMap }));

const blocks = () => map().getAllByRole("button", { hidden: true });

const block = (name: string) => blocks().find(each => (each.getAttribute("aria-label") ?? "").startsWith(name + ","));

it("u8012a_the_map_holds_one_block_per_item_in_list_order", async () => {
  await landed(() => ({ files: FILES }));
  await waitFor(() => expect(blocks().length).toBe(4));
  expect(blocks().map(each => each.getAttribute("aria-label")?.split(",")[0])).toEqual(moduleKeys().map(key => key?.slice(2)));
});

it("u8012a_a_click_on_a_block_opens_its_item", async () => {
  await landed(() => ({ files: FILES }));
  await showing("crates/a/src/x.rs");
  fireEvent.click(there("crates/c"));
  await showing("crates/c/tests/z.rs");
  await waitFor(() => expect(document.activeElement?.closest("[data-row]")?.getAttribute("data-key")).toBe("m:crates/c"));
  fireEvent.click(there("crates/c"));
  await showing("crates/c/tests/z.rs");
  expect(there("crates/c").getAttribute("aria-current")).toBe("true");
});

const there = (name: string) => {
  const found = block(name);

  if (!found) throw new Error(name);

  return found;
};

it("u8012a_a_blocks_name_says_the_item_its_size_and_whether_it_is_viewed", async () => {
  await landed(() => ({ files: FILES }));
  await showing("crates/a/src/x.rs");
  expect(there("crates/a").getAttribute("aria-label")).toBe(copy.mapBlock("crates/a", `${copy.addedLines(5)} ${copy.removedLines(1)}`, false));
  expect(there("crates/a").getAttribute("aria-current")).toBe("true");
  expect(there("crates/d").getAttribute("aria-label")).toBe(copy.mapBlock("crates/d", "", false));
  press("v");
  await waitFor(() => expect(there("crates/a").getAttribute("aria-label")).toBe(copy.mapBlock("crates/a", `${copy.addedLines(5)} ${copy.removedLines(1)}`, true)));
});

it("u8012b_marking_fills_a_block_and_the_open_mark_moves_on", async () => {
  await landed(() => ({ files: FILES }));
  await showing("crates/a/src/x.rs");
  expect(there("crates/a").hasAttribute("data-open")).toBe(true);
  expect(there("crates/a").hasAttribute("data-viewed")).toBe(false);
  press("v");
  await showing("crates/b/src/y.rs");
  expect(there("crates/a").hasAttribute("data-viewed")).toBe(true);
  expect(there("crates/a").hasAttribute("data-open")).toBe(false);
  expect(there("crates/b").hasAttribute("data-open")).toBe(true);
});

it("u8012b_viewed_blocks_stay_when_their_rows_are_hidden", async () => {
  await landed(() => ({ files: FILES }));
  await showing("crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");
  await waitFor(() => expect(moduleKeys()).not.toContain("m:crates/a"));
  expect(blocks().length).toBe(4);
  fireEvent.click(there("crates/a"));
  await showing("crates/a/src/x.rs");
  expect(moduleKeys()).toContain("m:crates/a");
  showViewedRows();
});

it("u8012b_each_lens_has_its_own_blocks", async () => {
  await landed(() => ({ files: FILES }));
  await showing("crates/a/src/x.rs");
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(blocks().length).toBe(Number(lensGroup().getByRole("radio", { name: tabNamed(copy.lenses.tests) }).getAttribute("aria-label")?.split(" ").at(-1))));
  expect(blocks().length).toBeLessThan(4);
});
