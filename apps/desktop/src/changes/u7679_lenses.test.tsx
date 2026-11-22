import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { rowOf } from "../rail/railFixture";
import { copy } from "./copy";
import { marked, openChanges, saveNote, take, startNote } from "./noteHarness";
import { MODS, THREE, absent, at, calls, chooseLens, closeButton, content, counted, drawn, edited, file, fileRows, gone, isOpen, landed, lensGroup, lensNow, marks, moduleKeys, moduleRow, mountRailWith, multi, noiseRows, open, openPaths, owning, pane, press, region, scrolled, scrolledTo, scroller, setUpView, showing, slot, switchedTo, takeNoise, there, treeFocus, written } from "./viewHarness";

setUpView();

// U7679: the lens switch, the Overview and the find.

it("u7679c_when_the_open_module_leaves_focus_moves_to_its_neighbour_else_the_overview", async () => {
  let list = MODS;
  const { connected } = await open(() => ({ files: list }));

  await showing("a/x.ts");
  list = MODS.slice(1);
  await connected.owned.refresh("a");
  await screen.findByText(copy.fileGone("a", copy.remoteMain));
  await showing("b/x.ts");
  await waitFor(() => expect(treeFocus()).toBe("m:b"));
  press("j");
  await showing("c/x.ts");

  // The last module leaves: its previous neighbour opens.
  list = MODS.slice(1, 2);
  await connected.owned.refresh("a");
  await screen.findByText(copy.fileGone("c", copy.remoteMain));
  await showing("b/x.ts");
  await waitFor(() => expect(treeFocus()).toBe("m:b"));

  // No module is left but a noise file: the lens's Overview row opens and takes focus.
  list = [file("yarn.lock")];
  await connected.owned.refresh("a");
  await screen.findByText(copy.fileGone("b", copy.remoteMain));
  await screen.findByRole("region", { name: copy.overview });
  await waitFor(() => expect(treeFocus()).toBe("o"));

  // No file is left: focus stays in the view, so Escape still closes it.
  list = [];
  await connected.owned.refresh("a");
  await screen.findByText(copy.noChangesAgainst(copy.remoteMain));
  await waitFor(() => expect(region().contains(document.activeElement)).toBe(true));
  press("Escape", there(document.activeElement));
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
});

it("u7679e_j_and_k_step_the_overview_and_the_modules_and_skip_noise_rows", async () => {
  // List order: the Overview, the modules by name, then the noise rows.
  await landed(() => ({ files: ["c/x.ts", "yarn.lock", "a/x.ts", "b/y.ts"].map(file) }));
  take(overviewRow());
  pane();

  // K on the Overview does nothing; J steps to each module and stops at the last, K back to the Overview.
  press("k");
  pane();
  press("j");
  await showing("a/x.ts");
  press("j");
  await showing("b/y.ts");
  press("j");
  await showing("c/x.ts");
  press("j");
  press("k");
  await showing("b/y.ts");
  press("k");
  await showing("a/x.ts");
  press("k");
  await screen.findByRole("region", { name: copy.overview });
  press("k");
  pane();

  // A noise file opens alone: J does nothing, K opens the last module.
  await takeNoise("yarn.lock");
  await showing("yarn.lock");
  press("j");
  expect(region().querySelectorAll(".module-slot")).toHaveLength(1);
  isOpen("yarn.lock");
  press("k");
  await showing("c/x.ts");

  // A find holds letters: they step the modules shown, and with the open item hidden J opens the first and K the last.
  take(moduleRow("b"));
  await showing("b/y.ts");
  press("/");
  typeIn("x.ts");
  await waitFor(() => expect(moduleKeys()).toEqual(["m:a", "m:c"]));
  press("k");
  await showing("c/x.ts");
  press("Escape");
  await gone(() => screen.queryByRole("textbox", { name: copy.findFile }));
  take(moduleRow("b"));
  await showing("b/y.ts");
  press("/");
  typeIn("x.ts");
  await waitFor(() => expect(moduleKeys()).toEqual(["m:a", "m:c"]));
  press("j");
  await showing("a/x.ts");
});

it("u7679d_escape_clears_the_find_before_it_closes_the_view", async () => {
  await landed(() => ({ files: LENS_FILES }));
  take(moduleRow("crates/b"));
  await showing("crates/b/src/y.rs");
  press("/", moduleRow("crates/b"));
  await waitFor(() => expect(document.activeElement).toBe(finder()));
  typeIn("tests");
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/c"]));

  // Esc closes the ? list first, then the find, then the view.
  press("?");
  await screen.findByRole("region", { name: copy.keys });
  press("Escape");
  await gone(() => screen.queryByRole("region", { name: copy.keys }));
  expect(finder().value).toBe("tests");
  press("Escape");
  await gone(() => screen.queryByRole("textbox", { name: copy.findFile }));
  expect(moduleKeys()).toContain("m:crates/b");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/b"));
  region();
  press("Escape");
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
});

it("u7679c_reopening_restores_the_open_item_in_the_lens_last_used", async () => {
  let list = MODS;
  const { app } = await mountRailWith(id => owning(id === "a" ? list : [file("other.ts")]));
  const icon = () => within(rowOf("a")).findByRole("button", { name: copy.changedFiles(list.length) });
  const opener = await icon();

  fireEvent.click(opener);
  await screen.findByRole("region", { name: copy.overview });
  take(moduleRow("b"));
  await showing("b/x.ts");
  await switchedTo(copy.lenses.logic);
  await drawn();
  await marks(at("new", 1));
  press("]");
  press("]");
  await marks(at("new", 21));
  scrolled();
  const kept = scrolledTo(scroller());

  // Closing returns focus to the Rail icon; reopening restores the lens, the module, its scroll and line, with focus in the list.
  fireEvent.click(closeButton());
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
  fireEvent.click(opener);
  await showing("b/x.ts");
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.logic));
  await marks(at("new", 21));
  expect(written(scroller())[0]).toBe(kept);
  await waitFor(() => expect(treeFocus()).toBe("m:b"));

  // Another Agent keeps its own place and lens, and this one's are still here when it returns.
  fireEvent.click(rowOf("b"));
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.modules));
  await screen.findByRole("region", { name: copy.overview });
  fireEvent.click(rowOf("a"));
  await showing("b/x.ts");
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.logic));
  await marks(at("new", 21));
  expect(written(scroller())[0]).toBe(kept);

  // The open module is restored only while it is still listed: else the lens's Overview.
  fireEvent.click(closeButton());
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
  list = [file("a/x.ts"), file("c/x.ts")];
  edited(app, "a");
  fireEvent.click(await icon());
  await screen.findByRole("region", { name: copy.overview });
  expect(lensNow()).toBe(copy.lenses.logic);
});

const LENS_FILES = [
  counted("crates/a/src/x.rs", 5, 1),
  counted("crates/a/tests/x.rs", 3, 2),
  counted("crates/b/src/y.rs", 7, 4),
  counted("crates/c/tests/z.rs", 2, 2),
  counted("README.md", 1, 1),
  counted("pnpm-lock.yaml", 40, 30),
  counted("crates/a/generated/g.rs", 9, 9),
];

/** One module's logic and a lockfile: the Tests lens lists no module. */
const SMALL = [counted("crates/a/src/x.rs", 5, 1), counted("pnpm-lock.yaml", 4, 4)];

/** The list's rows in order, each by its key (a file by its path: its key is its module's). */
const listKeys = () => [...region().querySelectorAll<HTMLElement>(".changes-tree [data-row]")].map(row => row.dataset.row === "file" ? row.dataset.path : row.dataset.key);

const overviewRow = () => there(region().querySelector<HTMLElement>('[data-row="overview"]'));

const entries = () => [...pane().querySelectorAll<HTMLElement>("[data-entry]")];

// SAFETY: the find field is the App's one text input, an HTMLInputElement.
const finder = () => screen.getByRole("textbox", { name: copy.findFile }) as HTMLInputElement;

const typeIn = (letters: string) => fireEvent.input(finder(), { target: { value: letters } });

/** The row or entry says its module's file count and sums. */
const holds = (row: Element, files: number, added: number, removed: number) => [copy.filesCount(files), copy.addedLines(added), copy.removedLines(removed)].every(part => row.textContent?.includes(part));

const noiseKeys = () => noiseRows().map(row => row.dataset.key);

const shiftL = () => fireEvent.keyDown(region(), { key: "L", shiftKey: true });

it("u7679a_the_switch_names_the_three_lenses_in_order_and_choosing_one_changes_the_list", async () => {
  await landed(() => ({ files: LENS_FILES }));
  const radios = Object.values(copy.lenses).map(name => lensGroup().getByRole("radio", { name }));

  expect(radios.every((each, at) => (radios[at - 1]?.compareDocumentPosition(each) ?? Node.DOCUMENT_POSITION_FOLLOWING) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(lensNow()).toBe(copy.lenses.modules);
  expect(moduleKeys()).toContain("m:crates/c");
  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/b", "m:" + copy.topLevel]));
});

it("u7679a_switching_keeps_the_open_item_when_the_lens_lists_it_else_opens_the_overview", async () => {
  await landed(() => ({ files: LENS_FILES }));
  take(moduleRow("crates/b"));
  await showing("crates/b/src/y.rs");
  await switchedTo(copy.lenses.logic);
  isOpen("crates/b/src/y.rs");

  // Tests lacks the module: its Overview opens.
  await chooseLens(copy.lenses.tests);
  await screen.findByRole("region", { name: copy.overview });
  expect(openPaths()).toEqual([]);

  // A noise file is the same diff in every lens, and every lens lists the Overview.
  await takeNoise("pnpm-lock.yaml");
  await showing("pnpm-lock.yaml");
  await chooseLens(copy.lenses.modules);
  isOpen("pnpm-lock.yaml");
  take(overviewRow());
  await chooseLens(copy.lenses.logic);
  pane();
});

it("u7679a_each_lens_keeps_its_own_place_in_a_module", async () => {
  await landed(() => ({ files: LENS_FILES }), path => multi(path));
  take(moduleRow("crates/a"));
  await drawn("crates/a/src/x.rs");
  await marks(at("new", 1), "crates/a/src/x.rs");
  press("]");
  press("]");
  await marks(at("new", 21), "crates/a/src/x.rs");
  scrolled();
  const kept = scrolledTo(scroller());

  // Logic and Tests start the module at their own top; none takes another's place.
  await switchedTo(copy.lenses.logic);
  await drawn("crates/a/src/x.rs");
  await marks(at("new", 1), "crates/a/src/x.rs");
  press("]");
  await marks(at("old", 3), "crates/a/src/x.rs");
  await switchedTo(copy.lenses.tests);
  await drawn("crates/a/tests/x.rs");
  await marks(at("new", 1), "crates/a/tests/x.rs");
  await switchedTo(copy.lenses.modules);
  await marks(at("new", 21), "crates/a/src/x.rs");
  expect(written(scroller())[0]).toBe(kept);
  await switchedTo(copy.lenses.logic);
  await marks(at("old", 3), "crates/a/src/x.rs");
});

it("u7679a_l_and_shift_l_step_the_lenses_in_switch_order", async () => {
  await landed(() => ({ files: LENS_FILES }));
  take(moduleRow("crates/a"));
  await drawn("crates/a/src/x.rs");

  // From the list, then from the diff; both wrap at the ends.
  press("l", moduleRow("crates/a"));
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.logic));
  await drawn("crates/a/src/x.rs");
  press("l", there(content("crates/a/src/x.rs")));
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.tests));
  press("l");
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.modules));
  shiftL();
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.tests));
  shiftL();
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.logic));
});

it("u7679b_each_lens_lists_its_modules_with_its_own_files_and_counts", async () => {
  await landed(() => ({ files: LENS_FILES }));

  expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/b", "m:crates/c", "m:" + copy.topLevel]);
  expect(holds(moduleRow("crates/a"), 2, 8, 3)).toBe(true);
  expect(holds(moduleRow("crates/b"), 1, 7, 4)).toBe(true);
  expect(noiseKeys()).toEqual(["k:generated", "k:lockfile"]);

  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/b", "m:" + copy.topLevel]));
  expect(holds(moduleRow("crates/a"), 1, 5, 1)).toBe(true);
  expect(noiseKeys()).toEqual(["k:generated", "k:lockfile"]);

  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/c"]));
  expect(holds(moduleRow("crates/a"), 1, 3, 2)).toBe(true);
  expect(noiseKeys()).toEqual(["k:generated", "k:lockfile"]);
});

it("u7679b_logic_holds_no_test_or_noise_hunk_and_tests_holds_test_hunks_only", async () => {
  // A generated file under tests/ is noise, not a test; a binary file belongs to the lens its path says.
  const binary = { ...counted("crates/a/tests/data.bin", 0, 0), counts: null };

  await landed(() => ({ files: [counted("crates/a/src/x.rs", 1, 1), counted("crates/a/tests/x.rs", 1, 1), counted("crates/a/tests/generated/g.rs", 1, 1), binary] }));
  press("ArrowRight", moduleRow("crates/a"));
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/src/x.rs", "crates/a/tests/data.bin", "crates/a/tests/x.rs"]));
  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/src/x.rs"]));
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/tests/data.bin", "crates/a/tests/x.rs"]));
  expect(noiseKeys()).toEqual(["k:generated"]);
});

it("u7679b_a_module_opens_its_logic_in_logic_its_tests_in_tests_and_both_in_modules", async () => {
  await landed(() => ({ files: LENS_FILES }));
  take(moduleRow("crates/a"));
  await waitFor(() => expect(openPaths()).toEqual(["crates/a/src/x.rs", "crates/a/tests/x.rs"]));
  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(openPaths()).toEqual(["crates/a/src/x.rs"]));
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(openPaths()).toEqual(["crates/a/tests/x.rs"]));
});

it("u7679b_unfinished_work_marks_the_row_that_lists_the_file_in_each_lens", async () => {
  await landed(() => ({ files: LENS_FILES }), path => multi(path));

  const draft = async (path: string) => {
    await drawn(path);
    startNote();
    fireEvent.input(within(screen.getByRole("form", { name: copy.lineNote })).getByLabelText(copy.note), { target: { value: "half" } });
  };

  // A note on crates/a/tests/x.rs marks crates/a in Modules and Tests, and no row in Logic.
  await chooseLens(copy.lenses.tests);
  take(moduleRow("crates/a"));
  await draft("crates/a/tests/x.rs");
  await chooseLens(copy.lenses.modules);
  await waitFor(() => expect(marked()).toEqual(["module:m:crates/a"]));
  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(marked()).toEqual([]));
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(marked()).toEqual(["module:m:crates/a"]));

  // A note on a noise file marks that noise row in all three lenses; the Overview row never takes a mark.
  await takeNoise("pnpm-lock.yaml");
  await draft("pnpm-lock.yaml");

  for (const lens of Object.values(copy.lenses)) {
    await chooseLens(lens);
    await waitFor(() => expect(marked()).toContain("noise:k:lockfile"));
    expect(marked().some(key => key.startsWith("overview:"))).toBe(false);
  }
});

it("u7679b_a_jump_to_a_note_the_open_lens_does_not_list_switches_to_modules", async () => {
  await landed(() => ({ files: LENS_FILES }));
  await chooseLens(copy.lenses.tests);
  take(moduleRow("crates/a"));
  await drawn("crates/a/tests/x.rs");
  await saveNote("a test note");

  // Logic lacks crates/a/tests/x.rs: the jump switches to Modules and opens the file there.
  await chooseLens(copy.lenses.logic);
  take(moduleRow("crates/b"));
  await showing("crates/b/src/y.rs");
  press("g");
  press("Enter", await screen.findByRole("combobox", { name: copy.jumpToNote }));
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.modules));
  await showing("crates/a/tests/x.rs");
});

it("u7679c_the_overview_row_is_first_in_every_lens_and_never_takes_a_mark_or_a_place", async () => {
  await landed(() => ({ files: LENS_FILES }));
  const noise = ["k:generated", "k:lockfile"];

  expect(listKeys()).toEqual(["o", "m:crates/a", "m:crates/b", "m:crates/c", "m:" + copy.topLevel, ...noise]);
  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(listKeys()).toEqual(["o", "m:crates/a", "m:crates/b", "m:" + copy.topLevel, ...noise]));
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(listKeys()).toEqual(["o", "m:crates/a", "m:crates/c", ...noise]));

  // Down onto it, Up from the first module and a click open its pane; it holds no hunk, so it has no fold.
  take(moduleRow("crates/a"));
  await showing("crates/a/tests/x.rs");
  press("ArrowUp", moduleRow("crates/a"));
  pane();
  expect(treeFocus()).toBe("o");
  expect(overviewRow().hasAttribute("aria-expanded")).toBe(false);
  take(moduleRow("crates/c"));
  await showing("crates/c/tests/z.rs");
  fireEvent.click(overviewRow());
  pane();
  take(moduleRow("crates/c"));
  press("ArrowUp", moduleRow("crates/c"));
  await waitFor(() => expect(treeFocus()).toBe("m:crates/a"));
  press("ArrowUp", moduleRow("crates/a"));
  pane();
});

it("u7679c_the_overview_lists_the_lenses_modules_with_counts_and_a_lens_with_none_says_so", async () => {
  await landed(() => ({ files: LENS_FILES }));
  take(overviewRow());
  const listed = () => entries().map(each => each.dataset.entry);

  expect(listed()).toEqual(moduleKeys());
  expect(holds(entries()[0] ?? overviewRow(), 2, 8, 3)).toBe(true);
  expect(holds(entries()[1] ?? overviewRow(), 1, 7, 4)).toBe(true);
  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(listed()).toEqual(["m:crates/a", "m:crates/b", "m:" + copy.topLevel]));
  expect(holds(entries()[0] ?? overviewRow(), 1, 5, 1)).toBe(true);

  // A change with no test says so in Tests.
  cleanup();
  await landed(() => ({ files: SMALL }));
  take(overviewRow());
  await chooseLens(copy.lenses.tests);
  await screen.findByText(copy.noChangesIn(copy.lenses.tests));
  expect(entries()).toEqual([]);
});

it("u7679c_choosing_a_module_in_the_overview_opens_it", async () => {
  await landed(() => ({ files: LENS_FILES }));
  take(overviewRow());
  fireEvent.click(there(entries().find(each => each.dataset.entry === "m:crates/b")));
  await showing("crates/b/src/y.rs");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/b"));
});

it("u7679c_each_agent_keeps_its_lens_and_a_new_session_opens_on_modules", async () => {
  const mount = async () => {
    const mounted = await mountRailWith(() => owning(LENS_FILES));

    fireEvent.click(await within(rowOf("a")).findByRole("button", { name: copy.changedFiles(LENS_FILES.length) }));
    await screen.findByRole("region", { name: copy.overview });

    return mounted;
  };

  await mount();
  expect(lensNow()).toBe(copy.lenses.modules);
  await chooseLens(copy.lenses.tests);
  fireEvent.click(rowOf("b"));
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.modules));
  fireEvent.click(rowOf("a"));
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.tests));

  // Nothing is stored: a new session starts on Modules.
  cleanup();
  await mount();
  expect(lensNow()).toBe(copy.lenses.modules);
});

it("u7679c_the_view_opens_on_the_overview_of_the_lens_last_used", async () => {
  const { app } = await landed(() => ({ files: THREE }));

  pane();
  await waitFor(() => expect(treeFocus()).toBe("o"));
  expect(overviewRow().getAttribute("aria-selected")).toBe("true");
  expect(calls(app, "agent.compareFile")).toBe(0);
});

it("u7679d_slash_opens_the_find_and_a_letter_pressed_in_the_list_opens_nothing", async () => {
  await landed(() => ({ files: LENS_FILES }));
  take(moduleRow("crates/b"));
  await drawn("crates/b/src/y.rs");

  // A letter in the list opens nothing, and the keys of the list still fire.
  press("x", moduleRow("crates/b"));
  absent(() => screen.queryByRole("textbox", { name: copy.findFile }));
  press("k", moduleRow("crates/b"));
  await showing("crates/a/src/x.rs");

  // / opens the field with focus in it, from the list or the diff alike.
  press("/", moduleRow("crates/a"));
  await waitFor(() => expect(document.activeElement).toBe(finder()));
  press("Escape", finder());
  await gone(() => screen.queryByRole("textbox", { name: copy.findFile }));
  await drawn("crates/a/src/x.rs");
  press("/", there(content("crates/a/src/x.rs")));
  await waitFor(() => expect(document.activeElement).toBe(finder()));
});

it("u7679d_typed_letters_narrow_the_list_to_the_files_that_match", async () => {
  await landed(() => ({ files: LENS_FILES }));
  press("/");
  typeIn("TESTS");
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/tests/x.rs", "crates/c/tests/z.rs"]));
  expect(listKeys().filter(key => !key?.includes("/") || key.startsWith("m:"))).toEqual(["m:crates/a", "m:crates/c"]);
  expect(holds(moduleRow("crates/a"), 2, 8, 3)).toBe(true);
  typeIn("LOCK");
  await waitFor(() => expect(fileRows()).toEqual(["pnpm-lock.yaml"]));
  expect(noiseKeys()).toEqual(["k:lockfile"]);
  typeIn("crates/b");
  await waitFor(() => expect(fileRows()).toEqual(["crates/b/src/y.rs"]));

  // A row's label is not searched, and a file is searched in the open lens only.
  typeIn(copy.topLevel);
  await screen.findByText(copy.noFileMatches(copy.topLevel, copy.lenses.modules));
  await chooseLens(copy.lenses.logic);
  typeIn("x.rs");
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/src/x.rs"]));
});

it("u7679d_letters_that_match_nothing_say_so_and_show_no_row", async () => {
  await landed(() => ({ files: LENS_FILES }));
  press("/");
  typeIn("zzz");
  await screen.findByText(copy.noFileMatches("zzz", copy.lenses.modules));
  expect(listKeys()).toEqual([]);
});

it("u7679d_enter_opens_the_first_match_and_down_moves_into_the_list", async () => {
  await landed(() => ({ files: LENS_FILES }));
  press("/");
  typeIn("tests");
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/tests/x.rs", "crates/c/tests/z.rs"]));
  press("ArrowDown", finder());
  await waitFor(() => expect(treeFocus()).toBe("m:crates/a"));
  finder().focus();
  press("Enter", finder());
  await showing("crates/a/tests/x.rs");
  await waitFor(() => expect(document.activeElement?.closest("[data-row]")?.getAttribute("data-path")).toBe("crates/a/tests/x.rs"));
  expect(finder().value).toBe("tests");
});

it("u7679d_typed_letters_fire_no_key", async () => {
  const { app } = await landed(() => ({ files: LENS_FILES }), path => multi(path));

  take(moduleRow("crates/b"));
  await drawn("crates/b/src/y.rs");
  await marks(at("new", 1));
  press("/");
  await waitFor(() => expect(document.activeElement).toBe(finder()));

  for (const key of ["j", "k", "v", "x", "r", "g", "n", "l", "/", "]", "[", "?", "e", "Delete"]) press(key, finder());
  absent(() => screen.queryByRole("form", { name: copy.lineNote }));
  absent(() => screen.queryByRole("region", { name: copy.keys }));
  absent(() => screen.queryByRole("combobox", { name: copy.jumpToNote }));
  expect(lensNow()).toBe(copy.lenses.modules);
  isOpen("crates/b/src/y.rs");
  await marks(at("new", 1));
  expect(calls(app, "agent.compareFile")).toBe(1);
});

it("u7679d_finding_reads_no_file_and_leaves_the_open_scroll_alone", async () => {
  const { app } = await landed(() => ({ files: LENS_FILES }), path => multi(path));

  take(moduleRow("crates/b"));
  await drawn("crates/b/src/y.rs");
  const scrollNow = slot();
  const reads = calls(app, "agent.compareFile");
  const writes = written(scroller()).length;

  press("/");
  typeIn("tests");
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/c"]));
  expect(slot()).toBe(scrollNow);
  isOpen("crates/b/src/y.rs");
  expect(calls(app, "agent.compareFile")).toBe(reads);
  expect(written(scroller()).length).toBe(writes);
  expect(lensNow()).toBe(copy.lenses.modules);
});

it("u7679d_the_find_follows_a_lens_switch_and_a_closed_view_forgets_it", async () => {
  await landed(() => ({ files: LENS_FILES }));
  press("/");
  typeIn("tests");
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/tests/x.rs", "crates/c/tests/z.rs"]));
  await chooseLens(copy.lenses.logic);
  await screen.findByText(copy.noFileMatches("tests", copy.lenses.logic));
  expect(finder().value).toBe("tests");
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(fileRows()).toEqual(["crates/a/tests/x.rs", "crates/c/tests/z.rs"]));
  fireEvent.click(closeButton());
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  absent(() => screen.queryByRole("textbox", { name: copy.findFile }));
  expect(fileRows()).toEqual([]);
});

it("u7679e_in_the_overview_brackets_do_nothing_and_tab_walks_its_modules", async () => {
  const { app } = await landed(() => ({ files: LENS_FILES }));

  take(overviewRow());
  pane();
  press("]");
  press("[");
  press("Enter", overviewRow());
  expect(calls(app, "agent.compareFile")).toBe(0);
  expect(app.editorCalls).toEqual([]);

  // The entries follow the list in the tab order: Tab from the list goes to the first, Shift-Tab from the first back to the row.
  const tree = there(region().querySelector(".changes-tree"));

  expect(entries().every(each => each.tabIndex === 0 && tree.compareDocumentPosition(each) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  press("Tab", overviewRow());
  expect(document.activeElement).toBe(entries()[0]);
  fireEvent.keyDown(there(entries()[0]), { key: "Tab", shiftKey: true });
  await waitFor(() => expect(treeFocus()).toBe("o"));

  // A lens with no module holds no entry, and Tab does nothing.
  cleanup();
  await landed(() => ({ files: SMALL }));
  take(overviewRow());
  await chooseLens(copy.lenses.tests);
  await screen.findByText(copy.noChangesIn(copy.lenses.tests));
  press("Tab", overviewRow());
  expect(document.activeElement).toBe(overviewRow());
});

it("u7679e_the_keys_list_names_the_lens_and_find_keys", async () => {
  await landed(() => ({ files: LENS_FILES }));
  press("?");
  const items = within(await screen.findByRole("region", { name: copy.keys })).getAllByRole("listitem").map(item => item.textContent ?? "");

  expect(items.some(item => /^L\b.*lens/i.test(item))).toBe(true);
  expect(items.some(item => /^\/.*find/i.test(item))).toBe(true);
  expect(items.some(item => /^J and K\b.*Overview/.test(item))).toBe(true);
});
