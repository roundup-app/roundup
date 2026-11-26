import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { rowOf } from "../rail/railFixture";
import { message } from "../testing/centreFixture";
import { notices } from "../testing/notices";
import { copy } from "./copy";
import { mountControl, WORKTREE } from "./harness";
import { saveNote, take, treeRow, startNote } from "./noteHarness";
import { MODS, THREE, absent, at, calls, closeButton, comparison, content, counted, drawn, drawnIn, edited, file, fileRows, fresh, gone, isOpen, lineKinds, marks, moduleRow, mountRailWith, multi, noiseRows, offsets, open, openPaths, owning, pane, press, region, scrolled, scrolledTo, scroller, scrolls, section, setUpView, showing, slot, switchedTo, text, there, treeFocus, written } from "./viewHarness";
import type { Listing } from "./viewHarness";

setUpView();

/** Three changes: line 3 edited (old 3), a line added after line 20 (new 21), line 45 edited (old 45). */
const CHANGES = [{ side: "old", line: 3 }, { side: "new", line: 21 }, { side: "old", line: 45 }] as const;

/** The open scroll says `words`. */
const says = (words: string) => waitFor(() => expect(slot()?.textContent).toContain(words));

/** A listing the test releases itself: each read waits for `release`. */
const pausedListing = () => {
  const waiting: (() => void)[] = [];

  return {
    read: (files: ChangedFile[]) => new Promise<Listing>(resolve => { waiting.push(() => resolve({ files })); }),
    release: () => waiting.splice(0).forEach(each => each()),
  };
};

/** Opens a view over `THREE`, then lets `answer` decide every later listing: the leader opens only a view that has files. */
const reopened = async (answer: () => Listing) => {
  let later = false;
  const mounted = await open(() => later ? answer() : { files: THREE });

  await treeRow("a.ts");
  later = true;
  await mounted.connected.owned.refresh("a");

  return mounted;
};

const totals = () => document.querySelector(".changes-totals")?.textContent;

it("u7675a_opening_names_comparing_only_after_150_ms", async () => {
  const listing = pausedListing();
  const { connected } = await mountControl(() => listing.read(THREE), fresh());

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  connected.showView("changes");
  await vi.advanceTimersByTimeAsync(149);
  absent(() => screen.queryByText(copy.comparing));
  await vi.advanceTimersByTimeAsync(1);
  screen.getByText(copy.comparing);
  listing.release();
  vi.useRealTimers();
  await treeRow("a.ts");
  absent(() => screen.queryByText(copy.comparing));

  // An answer inside 150 ms never shows the line, even once the 150 ms have passed.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  connected.changeTargets.choose("a", "tree");
  await vi.advanceTimersByTimeAsync(100);
  listing.release();
  await vi.advanceTimersByTimeAsync(100);
  absent(() => screen.queryByText(copy.comparing));
  vi.useRealTimers();
  await treeRow("a.ts");
});

it("u7675a_an_empty_listing_says_what_it_matches", async () => {
  const { connected } = await reopened(() => ({ files: [] }));

  await screen.findByText(copy.noChangesAgainst(copy.remoteMain));
  connected.changeTargets.choose("a", "tree");
  await screen.findByText(copy.folderMatches("a", copy.remoteMain));
  absent(() => screen.queryByText(copy.noChangesAgainst(copy.remoteMain)));
});

it("u7675a_a_failed_comparison_names_its_cause_and_retries", async () => {
  const cause = "fatal: bad revision 'origin/main...HEAD': unknown revision or path not in the working tree";
  let failing = true;

  await reopened(() => {
    if (failing) throw new Error(cause);

    return { files: THREE };
  });
  await screen.findByText(words => words.includes(copy.compareFailed(copy.remoteMain, copy.changes)) && words.includes(cause));
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await treeRow("a.ts");
  absent(() => screen.queryByText(words => words.includes(copy.compareFailed(copy.remoteMain, copy.changes))));
});

it("u7675a_a_missing_folder_says_so_and_retry_checks_again", async () => {
  let failing = true;

  await reopened(() => {
    if (failing) throw new Error("worktree_missing: /p/a");

    return { files: THREE };
  });
  await screen.findByText(copy.folderGone("a"));
  absent(() => screen.queryByText(words => words.includes(copy.compareFailed(copy.remoteMain, copy.changes))));
  absent(() => screen.queryByText(copy.stillMissing));
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await screen.findByText(copy.stillMissing);
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await treeRow("a.ts");
  absent(() => screen.queryByText(copy.folderGone("a")));
});

/** The view opened over a listing that has not answered. */
const opening = (listing: ReturnType<typeof pausedListing>) => async () => {
  const mounted = await mountControl(() => listing.read(THREE), fresh());

  mounted.connected.showView("changes");

  return mounted;
};

it("u7675a_every_view_state_keeps_close_usable", async () => {
  const listing = pausedListing();

  const states = [
    { name: "opening", make: opening(listing), reached: () => Promise.resolve() },
    { name: "empty", make: () => reopened(() => ({ files: [] })), reached: () => screen.findByText(copy.noChangesAgainst(copy.remoteMain)) },
    { name: "failed", make: () => reopened(() => { throw new Error("bad ref"); }), reached: () => screen.findByText(words => words.includes("bad ref")) },
    { name: "missing", make: () => reopened(() => { throw new Error("worktree_missing: /p/a"); }), reached: () => screen.findByText(copy.folderGone("a")) },
  ];

  for (const state of states) {
    const { connected } = await state.make();

    await screen.findByRole("region", { name: copy.changes });
    await state.reached();
    fireEvent.click(closeButton());
    await gone(() => screen.queryByRole("region", { name: copy.changes }));
    connected.showView("changes");
    await screen.findByRole("region", { name: copy.changes });
    await waitFor(() => expect(region().contains(document.activeElement)).toBe(true));
    press("Escape", there(document.activeElement));
    await gone(() => screen.queryByRole("region", { name: copy.changes }));
    cleanup();
  }
});

it("u7675b_loading_names_the_file_only_after_150_ms", async () => {
  const waiting: (() => void)[] = [];
  let hold = false;
  const answer = (path: string) => hold && path === "b/x.ts" ? new Promise<FileComparison>(resolve => { waiting.push(() => resolve(comparison(path))); }) : comparison(path);

  await open(() => ({ files: MODS }), answer);
  await showing("a/x.ts");
  await drawn();
  hold = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  press("j");
  await vi.advanceTimersByTimeAsync(149);
  absent(() => screen.queryByText(copy.loadingFile("b/x.ts")));
  isOpen("a/x.ts");
  await vi.advanceTimersByTimeAsync(1);
  screen.getByText(copy.loadingFile("b/x.ts"));

  // The previous module stays, drawn, until the next one's first screen has painted.
  isOpen("a/x.ts");
  expect(lineKinds().length).toBeGreaterThan(0);
  waiting.splice(0).forEach(each => each());
  vi.useRealTimers();
  await showing("b/x.ts");
  absent(() => screen.queryByText(copy.loadingFile("b/x.ts")));

  // A read inside 150 ms never shows the line.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  press("j");
  await vi.advanceTimersByTimeAsync(100);
  absent(() => screen.queryByText(copy.loadingFile("c/x.ts")));
  vi.useRealTimers();
  await showing("c/x.ts");
});

it("u7675b_added_deleted_and_renamed_files_say_which", async () => {
  const answers = new Map([
    ["a/x.ts", comparison("a/x.ts", { status: "added", old: { kind: "absent", revision: "absent" }, new: text("n", "one\ntwo\n") })],
    ["b/x.ts", comparison("b/x.ts", { status: "deleted", old: text("o", "one\ntwo\n"), new: { kind: "absent", revision: "absent" } })],
    ["c/x.ts", comparison("c/x.ts", { status: "renamed", oldPath: "old/c.ts" })],
  ]);

  await open(() => ({ files: MODS }), path => there(answers.get(path)));
  await says(copy.statusNew);
  await waitFor(() => expect(lineKinds()).toEqual(["change-addition"]));
  press("j");
  await says(copy.statusDeleted);
  await waitFor(() => expect(lineKinds()).toEqual(["change-deletion"]));
  await marks(at("old", 1));
  press("j");
  await says(copy.renamedPaths("old/c.ts", "c/x.ts"));
  await waitFor(() => expect(lineKinds()).toEqual(["change-deletion", "change-addition"]));
});

it("u7675b_binary_and_mode_only_files_say_so", async () => {
  const answers = new Map([
    ["a/x.ts", comparison("a/x.ts", { old: { kind: "binary", revision: "o" }, new: { kind: "binary", revision: "n" } })],
    ["b/x.ts", comparison("b/x.ts", { old: text("o", "same\n"), new: text("n", "same\n") })],
  ]);

  await open(() => ({ files: MODS.slice(0, 2) }), path => there(answers.get(path)));
  await says(copy.binaryDiff);
  absent(() => screen.queryByRole("button", { name: /Add note/ }));
  absent(() => content("a/x.ts"));
  press("j");
  await says(copy.modeOnly);
  expect(lineKinds()).toEqual([]);
});

it("u7675b_whitespace_only_says_no_remaining_difference_and_can_show_it", async () => {
  await open(() => ({ files: [file("a.ts")] }), path => comparison(path, { old: text("o", "a b\n"), new: text("n", "a  b\n") }));
  await screen.findByText(copy.noDifference);
  expect(lineKinds()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: copy.showWhitespace }));
  await drawn();
  await gone(() => screen.queryByRole("button", { name: copy.showWhitespace }));
});

it("u7675b_too_large_offers_show_anyway", async () => {
  const side = (mark: string) => (mark + "\n").repeat(20001);

  await open(() => ({ files: [file("a.ts")] }), path => comparison(path, { old: text("o", side("x")), new: text("n", side("y")) }));
  await screen.findByText(copy.tooLarge);
  expect(lineKinds()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: copy.showAnyway }));
  await drawn();
  await gone(() => screen.queryByText(copy.tooLarge));
});

it("u7675b_a_file_changed_on_disk_offers_reload_and_never_reloads_itself", async () => {
  let blob = "one";
  const { app, connected } = await open(() => ({ files: [{ ...file("a.ts"), blob }] }), path => multi(path, blob));

  await drawn();
  await saveNote("kept");
  press("]");
  press("]");
  await marks(at("new", 21));
  expect(calls(app, "agent.compareFile")).toBe(1);
  blob = "two";
  await connected.owned.refresh("a");
  await screen.findByText(copy.updatedFile("a"));
  expect(calls(app, "agent.compareFile")).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: copy.reload }));
  await waitFor(() => expect(calls(app, "agent.compareFile")).toBe(2));
  absent(() => screen.queryByText(copy.updatedFile("a")));
  await waitFor(() => expect(scrolledTo(scroller())).toBe(0));
  await marks(at("new", 1));
  screen.getByRole("button", { name: copy.editNote(1) });
});

it("u7675c_when_the_open_file_leaves_its_pane_says_so", async () => {
  let list = MODS;
  const { connected } = await open(() => ({ files: list }));

  await showing("a/x.ts");
  list = MODS.slice(1);
  await connected.owned.refresh("a");
  await screen.findByText(copy.fileGone("a", copy.remoteMain));
  await showing("b/x.ts");
});

it("u7675c_a_changing_list_leaves_the_trees_focus_and_scroll_alone", async () => {
  // jsdom lays nothing out, so the list's scroll offset is the critic's: `just capture U7675g` draws it before and after (tree-scrolled, tree-list-changed). What stays here is that a row leaves or arrives in place: the focused row keeps its element, its focus and the open module, and the list is never written a scroll offset.
  let list = Array.from({ length: 6 }, (_, index) => file("f" + index + "/x.ts"));
  const { connected } = await open(() => ({ files: list }));
  const row = moduleRow("f3");

  take(row);
  await showing("f3/x.ts");

  const counted = (count: number) => waitFor(() => expect(totals()).toContain(copy.changedFiles(count)));

  // A module leaves, then one appears: neither is the focused row, so focus and the open module stay.
  list = list.slice(1);
  await connected.owned.refresh("a");
  await counted(5);
  expect(treeFocus()).toBe("m:f3");
  list = [...list, file("z/x.ts")];
  await connected.owned.refresh("a");
  await counted(6);
  expect(treeFocus()).toBe("m:f3");
  expect(moduleRow("f3")).toBe(row);
  expect(document.activeElement).toBe(row);
  absent(() => region().querySelector<HTMLElement>('[data-key="m:f0"]'));
  moduleRow("z");
  isOpen("f3/x.ts");
  absent(() => screen.queryByText(copy.fileGone("f0", copy.remoteMain)));
  expect([...scrolls.keys()].some(each => each.closest(".changes-side") !== null)).toBe(false);
});

it("u7675c_the_rail_count_and_header_totals_follow_the_list", async () => {
  let list = THREE;
  const { app } = await mountRailWith(() => owning(list));

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: copy.changedFiles(3) }));
  await screen.findByRole("region", { name: copy.changes });
  await waitFor(() => expect(totals()).toContain(copy.changedFiles(3)));
  list = THREE.slice(0, 1);
  edited(app, "a");
  await within(rowOf("a")).findByRole("button", { name: copy.changedFiles(1) });
  await waitFor(() => expect(totals()).toContain(copy.changedFiles(1)));
});

it("u7678d_each_module_keeps_its_scroll_and_line_across_switches", async () => {
  let revision = "one";
  const { connected } = await open(() => ({ files: MODS.map(each => ({ ...each, blob: revision })) }), path => multi(path, revision));

  await drawn();
  press("]");
  press("]");
  await marks(at("new", 21));
  scrolled();
  const kept = scrolledTo(scroller());

  expect(kept).toBeGreaterThan(0);
  press("j");
  await showing("b/x.ts");
  await marks(at("new", 1));
  expect(scrolledTo(scroller())).toBe(0);
  press("]");
  await marks(at("old", 3));
  scrolled();
  const other = scrolledTo(scroller());

  press("k");
  await showing("a/x.ts");
  await marks(at("new", 21));
  expect(written(scroller())[0]).toBe(kept);

  // The next change counts from the restored line.
  press("]");
  await marks(at("old", 45));
  press("j");
  await showing("b/x.ts");
  await marks(at("old", 3));
  expect(written(scroller())[0]).toBe(other);

  // A file whose blob changed starts at its top after Reload.
  revision = "two";
  await connected.owned.refresh("a");
  await screen.findByText(copy.updatedFile("a"));
  fireEvent.click(screen.getByRole("button", { name: copy.reload }));
  await marks(at("new", 1));
  expect(scrolledTo(scroller())).toBe(0);
});

it("u7675e_left_and_right_fold_a_folder", async () => {
  await open(() => ({ files: ["x/a.ts", "x/b.ts", "top.ts"].map(file) }));
  const folder = moduleRow("x");
  const files = () => region().querySelectorAll('[data-row="file"][data-owner="m:x"]').length;

  // Folded at first; Right unfolds without choosing the module, Left folds it again.
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  press("ArrowRight", folder);
  await waitFor(() => expect(folder.getAttribute("aria-expanded")).toBe("true"));
  expect(files()).toBe(2);
  expect(folder.getAttribute("aria-selected")).toBe("false");
  press("ArrowLeft", folder);
  await waitFor(() => expect(folder.getAttribute("aria-expanded")).toBe("false"));
  expect(files()).toBe(0);
});

it("u7675e_tab_moves_from_the_list_to_the_diff", async () => {
  await open(() => ({ files: MODS.slice(0, 2) }), path => multi(path));
  await drawn();
  press("]");
  await marks(at("old", 3));
  const row = moduleRow("a");

  take(row);
  expect(fireEvent.keyDown(row, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(content("a/x.ts"));
  await marks(at("old", 3));

  // Tab inside the diff is the browser's own.
  expect(fireEvent.keyDown(there(content("a/x.ts")), { key: "Tab" })).toBe(true);

  // A module with no focused line lands on its first.
  const next = moduleRow("b");

  take(next);
  await showing("b/x.ts");
  await drawn("b/x.ts");
  await marks(at("new", 1));
  expect(fireEvent.keyDown(next, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(content("b/x.ts"));
  await marks(at("new", 1));
});

it("u7678d_bracket_keys_step_changes_across_a_modules_files", async () => {
  const { app } = await open(() => ({ files: [file("m/a.ts"), file("m/b.ts")] }), path => multi(path));

  await drawn("m/a.ts");
  const tops: number[] = [];

  for (const change of CHANGES) {
    press("]");
    await marks(at(change.side, change.line), "m/a.ts");
    tops.push(scrolledTo(scroller()) ?? 0);
  }

  expect(tops).toEqual([...new Set(tops)].sort((left, right) => left - right));
  expect(calls(app, "agent.compareFile")).toBe(1);

  // ] at a file's last change crosses into the next file's first, reading that file.
  press("]");
  await marks(at("old", 3), "m/b.ts");
  expect(calls(app, "agent.compareFile")).toBe(2);
  press("]");
  await marks(at("new", 21), "m/b.ts");
  press("]");
  await marks(at("old", 45), "m/b.ts");

  // ] stops at the module's last change and [ at its first: the other key then steps once.
  press("]");
  press("[");
  await marks(at("new", 21), "m/b.ts");
  press("[");
  await marks(at("old", 3), "m/b.ts");

  // [ crosses back into the previous file's last change.
  press("[");
  await marks(at("old", 45), "m/a.ts");
  press("[");
  press("[");
  press("[");
  await marks(at("old", 3), "m/a.ts");
  press("[");
  press("]");
  await marks(at("new", 21), "m/a.ts");
  expect(scrolledTo(scroller())).toBeGreaterThanOrEqual(tops[1] ?? 0);
});

it("u7675e_question_mark_lists_the_keys", async () => {
  await open(() => ({ files: THREE }));
  await showing("a.ts");
  absent(() => screen.queryByRole("region", { name: copy.keys }));
  press("?");
  const keys = await screen.findByRole("region", { name: copy.keys });
  const items = within(keys).getAllByRole("listitem").map(item => item.textContent ?? "");

  // Up and Down, Left and Right, Tab, J and K, L, /, ] and [, V (Viewed), X, N, E and Delete, G, R (U7688), W and D (U7698a), Enter, Esc and ? are listed, and N on a list row (U7691a), and Left and Right for a focused diagram (U7703c).
  expect(items).toHaveLength(19);
  expect(items.filter(item => /^V\b/.test(item))).toHaveLength(1);
  expect(items.filter(item => /^R\b/.test(item))).toHaveLength(1);
  press("?");
  await gone(() => screen.queryByRole("region", { name: copy.keys }));
});

it("u7675e_keys_do_not_fire_while_typing_in_a_note_field", async () => {
  const { app } = await open(() => ({ files: THREE }));

  await drawn();
  startNote();
  const box = within(screen.getByRole("form", { name: copy.lineNote })).getByLabelText(copy.note);

  for (const key of ["j", "k", "l", "/", "]", "[", "v", "x", "?", "n", "e", "g", "Delete", "Backspace"]) press(key, box);
  await marks(at("new", 1));
  absent(() => screen.queryByRole("region", { name: copy.keys }));
  isOpen("a.ts");
  expect(calls(app, "agent.compareFile")).toBe(1);

  // Escape belongs to the field too: the view stays.
  press("Escape", box);
  region();
});

/** The paths `agent.compareFile` was asked for, in order. */
// SAFETY: the fake App logs the params it was given, and agent.compareFile's are { path: string }.
const readPaths = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter(call => call.method === "agent.compareFile").map(call => (call.params as { path: string }).path);

it("u7678a_files_show_only_inside_their_module_folded_at_first", async () => {
  await open(() => ({ files: [file("a/x.ts"), file("a/y.ts"), file("b/z.ts")] }));
  await showing("a/x.ts");
  const row = moduleRow("a");

  expect(fileRows()).toEqual([]);
  // The row names its module, its file count and the sums of its files' counts.
  expect([copy.filesCount(2), copy.addedLines(2), copy.removedLines(2)].every(part => row.textContent?.includes(part))).toBe(true);
  expect(row.getAttribute("aria-expanded")).toBe("false");
  press("ArrowRight", row);
  await waitFor(() => expect(fileRows()).toEqual(["a/x.ts", "a/y.ts"]));

  // Both belong to their module, each with its own counts; the other module has none.
  expect([...region().querySelectorAll<HTMLElement>('[data-row="file"]')].map(each => each.dataset.owner)).toEqual(["m:a", "m:a"]);
  expect(there(region().querySelector('[data-row="file"]')).textContent).toContain(copy.addedLines(1) + " " + copy.removedLines(1));
  press("ArrowLeft", row);
  await waitFor(() => expect(fileRows()).toEqual([]));
});

it("u7678a_up_and_down_open_the_module_that_takes_focus", async () => {
  const { app } = await open(() => ({ files: [file("a/x.ts"), file("b/x.ts"), file("yarn.lock")] }));

  await showing("a/x.ts");
  press("ArrowDown", moduleRow("a"));
  await showing("b/x.ts");
  expect(treeFocus()).toBe("m:b");
  press("ArrowUp", moduleRow("b"));
  await showing("a/x.ts");
  expect(treeFocus()).toBe("m:a");

  // A noise row takes focus and opens nothing: the open scroll stays, and no read names its file.
  press("ArrowDown", moduleRow("a"));
  await showing("b/x.ts");
  press("ArrowDown", moduleRow("b"));
  await waitFor(() => expect(treeFocus()).toBe("k:lockfile"));
  expect(openPaths()).toEqual(["b/x.ts"]);
  expect(readPaths(app)).not.toContain("yarn.lock");
});

it("u7678b_noise_folds_to_quiet_rows_whose_files_open_alone", async () => {
  let list = [file("m/x.ts"), file("yarn.lock"), file("go.sum")];
  const { app, connected } = await open(() => ({ files: list }));

  await showing("m/x.ts");

  // A row stands only for a kind the change holds; it names its files and shows no counts.
  expect(noiseRows().map(row => row.textContent)).toEqual([copy.noiseRow(copy.lockfiles, 2)]);
  list = [...list, file("api/generated/x.ts")];
  await connected.owned.refresh("a");
  await waitFor(() => expect(noiseRows().map(row => row.textContent)).toEqual([copy.noiseRow(copy.generated, 1), copy.noiseRow(copy.lockfiles, 2)]));

  // Folded at first; a file under it opens alone, and the module's scroll never holds it.
  expect(fileRows()).toEqual([]);
  press("ArrowRight", there(noiseRows()[1]));
  take(await waitFor(() => there(region().querySelector<HTMLElement>('[data-row="file"][data-path="yarn.lock"]'))));
  await showing("yarn.lock");
  expect(openPaths()).toEqual(["yarn.lock"]);
  take(moduleRow("m"));
  await showing("m/x.ts");
  expect(openPaths()).toEqual(["m/x.ts"]);
  expect(new Set(readPaths(app))).toEqual(new Set(["m/x.ts", "yarn.lock"]));
});

it("u7678c_a_module_opens_as_one_scroll_with_logic_before_tests", async () => {
  await open(() => ({ files: ["m/b.test.ts", "m/b.ts", "m/a.ts", "m/a.test.ts", "n/c.ts"].map(file) }));
  await showing("m/a.ts");

  expect(slot()?.querySelectorAll(".module-scroll")).toHaveLength(1);
  expect(openPaths()).toEqual(["m/a.ts", "m/b.ts", "m/a.test.ts", "m/b.test.ts"]);

  for (const path of openPaths()) expect(section(there(path ?? null))?.textContent).toContain(path);
});

it("u7678c_one_files_notice_leaves_the_other_sections_alone", async () => {
  let failing = true;

  const { app } = await open(() => ({ files: [file("m/a.ts"), file("m/b.ts")] }), path => {
    if (path === "m/b.ts" && failing) throw new Error("read refused");

    return multi(path);
  });

  await drawn("m/a.ts");

  // After a's last change, `]` leaves for b, which reads and fails.
  for (const change of CHANGES) {
    press("]");
    await marks(at(change.side, change.line), "m/a.ts");
  }

  press("]");
  await waitFor(() => expect(notices("alert")).toHaveLength(1));
  const before = readPaths(app).length;

  // a keeps its drawn lines, and Retry reads b alone.
  await drawn("m/a.ts");
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await drawn("m/b.ts");
  await waitFor(() => expect(notices("alert")).toHaveLength(0));
  expect(readPaths(app).slice(before)).toEqual(["m/b.ts"]);
});

/** A note made in a scroll of module `m` keeps its file, side and line, and the Message names that file; `lens` is the one the scroll is read in. */
const keepsItsNote = async (lens?: string) => {
  const { app } = await open(() => ({ files: [file("m/a.ts"), file("m/b.ts")] }), path => multi(path));

  if (lens) await switchedTo(lens);

  const write = async (path: string, words: string) => {
    fireEvent.keyDown(there(content(path)), { key: "n" });
    const form = within(await screen.findByRole("form", { name: copy.lineNote }));

    fireEvent.input(form.getByLabelText(copy.note), { target: { value: words } });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    await gone(() => screen.queryByRole("form", { name: copy.lineNote }));
  };

  await drawn("m/a.ts");
  await write("m/a.ts", "first");

  for (const change of CHANGES) {
    press("]");
    await marks(at(change.side, change.line), "m/a.ts");
  }

  press("]");
  await marks(at("old", 3), "m/b.ts");
  await write("m/b.ts", "second");
  let sent: unknown;

  app.handlers["message.send"] = params => {
    sent = JSON.parse(params.body);

    return message(1, { to: params.to, body: params.body });
  };

  fireEvent.click(within(screen.getByLabelText(copy.notesRegion, { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await waitFor(() => expect(sent).toBeDefined());
  expect(sent).toMatchObject({ notes: [
    { "File:": { new: "m/a.ts" }, "Lines:": "new 1-1", "User comment:": "first" },
    { "File:": { new: "m/b.ts" }, "Lines:": "old 3-3", "User comment:": "second" },
  ] });
};

it("u7678c_a_note_made_in_a_scroll_keeps_its_file_side_and_line", () => keepsItsNote());

it("u7679b_a_note_made_in_logic_keeps_its_file_side_and_line", () => keepsItsNote(copy.lenses.logic));

it("u7678c_enter_or_a_double_click_on_a_hunk_opens_its_file_in_the_editor", async () => {
  const { app } = await open(() => ({ files: [file("m/a.ts"), file("m/b.ts")] }), path => multi(path));
  const lineOf = (type: string, line: number) => there(drawnIn("m/a.ts").flatMap(each => [...each.shadowRoot?.querySelectorAll("[data-line]") ?? []]).find(each => each.getAttribute("data-line-type") === type && each.getAttribute("data-line") === String(line)));

  await drawn("m/a.ts");
  press("]");
  press("]");
  await marks(at("new", 21), "m/a.ts");

  // Enter opens the focused line; a double click, the line it lands on; a removed line has no place in the file, so the file opens at its own line.
  press("Enter", there(content("m/a.ts")));
  fireEvent.dblClick(lineOf("change-addition", 21));
  fireEvent.dblClick(lineOf("change-deletion", 3));
  await waitFor(() => expect(app.editorCalls).toEqual([
    { path: `${WORKTREE.path}/m/a.ts`, line: 21 },
    { path: `${WORKTREE.path}/m/a.ts`, line: 21 },
    { path: `${WORKTREE.path}/m/a.ts`, line: 1 },
  ]));
});

it("u7678c_a_file_row_opens_its_modules_scroll_at_that_files_first_hunk", async () => {
  const { app } = await open(() => ({ files: ["m/a.ts", "m/b.ts", "m/c.ts"].map(file) }), path => multi(path));
  const tops = new Map([["m/b.ts", 100], ["m/c.ts", 300]]);

  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    // A section sits where the scroll has not moved past it, as layout puts it.
    const path = this instanceof HTMLElement ? this.dataset.path : undefined;
    const top = path === undefined ? 0 : (tops.get(path) ?? 0) - (offsets.get(there(scroller())) ?? 0);

    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
  });
  await drawn("m/a.ts");
  const row = (path: string) => there(region().querySelector<HTMLElement>(`[data-row="file"][data-path="${path}"]`));

  press("ArrowRight", moduleRow("m"));

  // The scroll moves to c's section and reads c; b, above it, stays unread.
  take(row("m/c.ts"));
  await drawn("m/c.ts");
  expect(scrolledTo(scroller())).toBe(300);
  expect(readPaths(app)).toEqual(["m/a.ts", "m/c.ts"]);
  take(row("m/b.ts"));
  await drawn("m/b.ts");
  expect(scrolledTo(scroller())).toBe(100);
  expect(slot()?.querySelectorAll(".module-scroll")).toHaveLength(1);
});

it("u7854d_a_new_file_is_labelled_new", async () => {
  const created = (path: string, status: "added" | "untracked"): ChangedFile => ({ ...file(path), status });

  await open(() => ({ files: [created("a/x.ts", "untracked"), created("b/x.ts", "added"), file("c/x.ts")] }), path => comparison(path, { status: "untracked", old: { kind: "absent", revision: "absent" }, new: text("n", "one\n") }));

  // A created file's row says New, an untracked one as an added one, and a modified file's says nothing.
  for (const path of ["a/x.ts", "b/x.ts"]) expect((await treeRow(path)).textContent).toContain(copy.statusNew);
  expect((await treeRow("c/x.ts")).textContent).not.toContain(copy.statusNew);
  await waitFor(() => expect(section("a/x.ts")?.querySelector(".diff-status")?.textContent).toBe(copy.statusNew));
});

it("u7854e_a_failed_file_read_shows_in_the_pane_with_retry", async () => {
  await open(() => ({ files: [file("m/a.ts")] }), () => { throw new Error("no_worktree: 16"); });

  const [failure] = await waitFor(() => {
    const found = notices("alert");

    expect(found).toHaveLength(1);

    return found;
  });

  const pane = there(section("m/a.ts"));

  // Inside that file's pane, under its header: plain words, no raw code and nothing to dismiss.
  expect(pane.contains(failure ?? null)).toBe(true);
  expect(pane.querySelector(".diff-header")?.contains(failure ?? null)).toBe(false);
  expect(failure?.textContent).toBe(copy.fileReadFailed("m/a.ts"));
  expect(screen.queryByRole("button", { name: copy.dismissFailure })).toBeNull();
  // What Retry reads and clears is proven by u7678c_one_files_notice_leaves_the_other_sections_alone.
  expect(within(pane).getAllByRole("button", { name: copy.retry })).toHaveLength(1);
});
