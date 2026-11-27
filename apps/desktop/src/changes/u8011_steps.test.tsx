import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { Spot } from "@contracts/agent/Spot";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges } from "./noteHarness";
import { at, counted, fresh, isOpen, landed, marks, moduleKeys, moduleRow, multi, press, region, scroller, scrolledTo, setUpView, showing, showViewedRows, there, treeFocus, written } from "./viewHarness";

setUpView();

// U8011: Space reads on, a viewed row leaves the list, a row's dot opens its first flagged line.

const f = (path: string, blob = "one"): ChangedFile => ({ ...counted(path, 1, 1), blob: `${path}@${blob}` });

const THREE = [f("crates/a/src/x.rs"), f("crates/b/src/y.rs"), f("crates/c/src/z.rs")];

const space = (target: Element = region(), shift = false) => fireEvent.keyDown(target, { key: " ", code: "Space", shiftKey: shift });

const toggle = () => region().querySelector<HTMLElement>(".changes-viewed-toggle");

/** The open item's scroll is `height` tall in a pane of 100. */
const sized = (height: number) => {
  Object.defineProperty(there(scroller()), "clientHeight", { configurable: true, value: 100 });
  Object.defineProperty(there(scroller()), "scrollHeight", { configurable: true, value: height });
};

const choose = async (name: string, path: string) => {
  fireEvent.click(moduleRow(name));
  await showing(path);
};

it("u8011a_space_mid_item_scrolls_and_marks_nothing", async () => {
  const { app } = await landed(() => ({ files: THREE }));

  await showing("crates/a/src/x.rs");
  sized(300);
  const reads = app.calls.filter(call => call.method === "agent.compareFile").length;

  space();
  expect(scrolledTo(scroller())).toBe(100);
  space();
  expect(scrolledTo(scroller())).toBe(200);
  screen.getByText(copy.viewedProgress(0, 3));
  isOpen("crates/a/src/x.rs");
  expect(app.calls.filter(call => call.method === "agent.compareFile").length).toBe(reads);
});

it("u8011a_space_at_the_items_end_marks_it_and_opens_the_next_unviewed_item", async () => {
  await landed(() => ({ files: THREE }));
  await showing("crates/a/src/x.rs");
  sized(300);
  space();
  space();

  // A press that scrolled to the end only scrolled.
  screen.getByText(copy.viewedProgress(0, 3));
  space();
  await screen.findByText(copy.viewedProgress(1, 3));
  await showing("crates/b/src/y.rs");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/b"));
});

it("u8011a_shift_space_scrolls_back_and_never_un_marks", async () => {
  await landed(() => ({ files: THREE }));
  await showing("crates/a/src/x.rs");
  sized(300);

  // At the top it does nothing.
  space(region(), true);
  screen.getByText(copy.viewedProgress(0, 3));

  space();
  space(region(), true);
  expect(scrolledTo(scroller())).toBe(0);
  screen.getByText(copy.viewedProgress(0, 3));

  // Space at the end of an item already viewed opens the next unviewed item and leaves the mark.
  press("v");
  await showing("crates/b/src/y.rs");
  showViewedRows();
  await choose("crates/a", "crates/a/src/x.rs");
  sized(100);
  space();
  await showing("crates/b/src/y.rs");
  screen.getByText(copy.viewedProgress(1, 3));
});

it("u8011a_space_in_a_note_field_types_a_space", async () => {
  await landed(() => ({ files: THREE }));
  await showing("crates/a/src/x.rs");
  sized(100);
  const input = document.createElement("textarea");

  region().appendChild(input);
  space(input);
  isOpen("crates/a/src/x.rs");
  screen.getByText(copy.viewedProgress(0, 3));
});

it("u8011b_a_viewed_row_leaves_the_list", async () => {
  await landed(() => ({ files: THREE }));
  await showing("crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");
  press("v");
  await showing("crates/c/src/z.rs");
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/c"]));
  screen.getByText(copy.viewedProgress(2, 3));
});

it("u8011b_the_open_item_stays_listed_until_another_opens", async () => {
  await landed(() => ({ files: THREE }));
  await showing("crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");

  // The marked item left at once; the open item b is listed, and J and K walk the rows the list shows.
  expect(moduleKeys()).toEqual(["m:crates/b", "m:crates/c"]);
  press("j");
  await showing("crates/c/src/z.rs");
  press("k");
  await showing("crates/b/src/y.rs");

  press("v");
  await showing("crates/c/src/z.rs");
  press("v");
  await screen.findByText(copy.viewedProgress(3, 3));
  expect(moduleKeys()).toEqual(["m:crates/c"]);
  isOpen("crates/c/src/z.rs");
});

it("u8011b_the_toggle_lists_the_viewed_rows_again", async () => {
  await landed(() => ({ files: THREE }));
  await showing("crates/a/src/x.rs");
  expect(toggle()).toBeNull();
  press("v");
  await showing("crates/b/src/y.rs");

  const button = await waitFor(() => there(toggle()));

  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(within(region()).getByRole("button", { name: copy.showViewed })).toBe(button);
  fireEvent.click(button);
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/b", "m:crates/c"]));
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(moduleRow("crates/a").getAttribute("aria-label")).toContain(copy.viewed);
  fireEvent.click(button);
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/b", "m:crates/c"]));
});

it("u8011b_a_changed_item_returns_to_the_list", async () => {
  let list = THREE;
  const { connected } = await landed(() => ({ files: list }));

  await showing("crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");
  expect(moduleKeys()).not.toContain("m:crates/a");

  list = THREE.map(file => file.path === "crates/a/src/x.rs" ? f(file.path, "two") : file);
  await connected.owned.refresh("a");
  await waitFor(() => expect(moduleKeys()).toContain("m:crates/a"));
  expect(moduleRow("crates/a").getAttribute("aria-label")).toContain(copy.changedSinceViewed);
});

const REPEAT: Spot = { source: { kind: "repeats" }, path: "crates/b/src/y.rs", start: 21, end: 21, other: { path: "crates/c/src/z.rs", start: 1, end: 1 }, stale: false };

const withRepeat = async () => {
  const mounted = await mountControl(() => ({ files: THREE }), fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => multi(path);
  mounted.app.handlers["agent.repeatScan"] = () => ({ spots: [REPEAT], complete: true });
  await openChanges();
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await showing("crates/a/src/x.rs");
  await waitFor(() => expect(moduleRow("crates/b").querySelector(".changes-row-dot")).not.toBeNull());

  return mounted;
};

const dot = () => there(moduleRow("crates/b").querySelector<HTMLElement>(".changes-row-slot"));

it("u8011c_clicking_a_dot_focuses_the_first_flagged_line", async () => {
  await withRepeat();
  fireEvent.click(dot());
  await showing("crates/b/src/y.rs");
  await marks(at("new", 21), "crates/b/src/y.rs");
});

it("u8011c_clicking_the_row_focuses_the_items_top", async () => {
  await withRepeat();
  fireEvent.click(moduleRow("crates/b"));
  await showing("crates/b/src/y.rs");
  await marks(at("new", 1), "crates/b/src/y.rs");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/b"));
});

it("u8011c_clicking_the_dot_of_the_open_item_moves_to_its_flagged_line", async () => {
  const { app } = await withRepeat();

  fireEvent.click(moduleRow("crates/b"));
  await marks(at("new", 1), "crates/b/src/y.rs");
  const reads = app.calls.filter(call => call.method === "agent.compareFile").length;

  fireEvent.click(dot());
  await marks(at("new", 21), "crates/b/src/y.rs");
  expect(app.calls.filter(call => call.method === "agent.compareFile").length).toBe(reads);
  expect(written(scroller()).length).toBeGreaterThan(0);
});
