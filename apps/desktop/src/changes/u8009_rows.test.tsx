import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import type { Spot } from "@contracts/agent/Spot";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges, take } from "./noteHarness";
import { chooseLens, comparison, counted, fresh, landed, lensGroup, moduleRow, press, region, setUpView, tabNamed } from "./viewHarness";

setUpView();

// U8009: a row's words, a shared name's folder and the tabs.

const FILES = [
  counted("crates/a/src/x.rs", 5, 1),
  counted("crates/a/tests/x.rs", 3, 2),
  counted("crates/b/src/y.rs", 7, 4),
  counted("crates/c/tests/z.rs", 2, 2),
  counted("scenarios/s.md", 1, 0),
  counted("crates/a/scenarios/t.md", 1, 0),
  counted("README.md", 1, 1),
];

const rowText = (name: string) => moduleRow(name).textContent ?? "";

const REPEAT: Spot = { source: { kind: "repeats" }, path: "crates/a/src/x.rs", start: 1, end: 3, other: { path: "crates/c/tests/z.rs", start: 1, end: 3 }, stale: false };

it("u8009a_a_rows_accessible_name_says_its_counts_viewed_state_and_each_signal", async () => {
  const mounted = await mountControl(() => ({ files: FILES }), fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => comparison(path);
  mounted.app.handlers["agent.repeatScan"] = () => ({ spots: [REPEAT], complete: true });
  await openChanges();
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(moduleRow("crates/a").getAttribute("aria-label")).toContain(copy.repeatsCount(1)));
  const name = moduleRow("crates/a").getAttribute("aria-label") ?? "";

  for (const part of ["crates/a", copy.filesCount(2), copy.addedLines(8), copy.removedLines(3)]) expect(name).toContain(part);
  expect(name).not.toContain(copy.viewed);
  take(moduleRow("crates/a"));
  press("v");
  await waitFor(() => expect(moduleRow("crates/a").getAttribute("aria-label")).toContain(copy.viewed));
});

it("u8009a_only_the_open_row_shows_its_exact_counts", async () => {
  await landed(() => ({ files: FILES }));
  take(moduleRow("crates/b"));
  await waitFor(() => expect(rowText("crates/b")).toContain(`${copy.addedLines(7)} ${copy.removedLines(4)}`));
  expect(rowText("crates/b")).not.toContain(copy.filesCount(1));
  expect(rowText("crates/c")).not.toContain(copy.addedLines(2));
  expect(rowText("crates/a")).not.toContain(copy.filesCount(2));
});

it("u8009b_two_rows_sharing_a_name_both_show_their_folder_and_a_unique_one_shows_none", async () => {
  await landed(() => ({ files: FILES }));
  const folder = (name: string) => moduleRow(name).querySelector(".changes-row-folder")?.textContent;

  expect(folder("scenarios")).toBe(copy.rootFolder);
  expect(folder("crates/a/scenarios")?.startsWith("crates/a")).toBe(true);
  expect(folder("crates/b")).toBeUndefined();
});

it("u8009c_each_tabs_accessible_name_holds_its_count", async () => {
  await landed(() => ({ files: FILES }));
  const tab = (name: string) => lensGroup().getByRole("radio", { name: tabNamed(name) }).getAttribute("aria-label");

  expect(tab(copy.lenses.modules)).toBe(copy.tabCount(copy.lenses.modules, 6));
  expect(tab(copy.lenses.logic)).toBe(copy.tabCount(copy.lenses.logic, 5));
  expect(tab(copy.lenses.tests)).toBe(copy.tabCount(copy.lenses.tests, 2));
});

it("u8009c_the_line_under_the_tabs_changes_with_the_tab", async () => {
  await landed(() => ({ files: FILES }));
  expect(region().textContent).toContain(copy.lensLines.modules);
  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(region().textContent).toContain(copy.lensLines.logic));
  expect(region().textContent).not.toContain(copy.lensLines.modules);
});

it("u8034_a_rows_mark_is_one_control_whose_tooltip_and_name_say_its_most_urgent_signal", async () => {
  const mounted = await mountControl(() => ({ files: FILES }), fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => comparison(path);
  mounted.app.handlers["agent.repeatScan"] = () => ({ spots: [REPEAT, { ...REPEAT, start: 5, end: 7 }], complete: true });
  await openChanges();
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  const row = moduleRow("crates/a");

  await waitFor(() => expect(row.querySelectorAll(".changes-row-slot button")).toHaveLength(1));
  const mark = within(row).getByRole("button", { name: copy.repeatsCount(2) });

  vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
  fireEvent.pointerEnter(mark, { pointerType: "mouse", clientX: 10, clientY: 10 });
  expect((await screen.findByRole("tooltip")).textContent).toBe(copy.repeatsCount(2));
});
