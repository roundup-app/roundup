import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { mountRail, rowOf } from "../rail/railFixture";
import { agent } from "../testing/nodes";
import { copy } from "./copy";
import { openChanges, take } from "./noteHarness";
import { chooseLens, closeButton, comparison, counted, gone, isOpen, landed, lensNow, moduleKeys, moduleRow, owning, pane, press, region, setUpView, showing, takeNoise, there, treeFocus } from "./viewHarness";

setUpView();

// U7680: Viewed marks, the count, the next item and a change that un-marks.

/** A file with its own blob: a rewrite that keeps its counts is a new blob. */
const f = (path: string, blob = "one"): ChangedFile => ({ ...counted(path, 1, 1), blob: `${path}@${blob}` });

/** Three modules of logic and a lockfile: the Tests lens lists no module. */
const LOGIC = [f("crates/a/src/x.rs"), f("crates/b/src/y.rs"), f("crates/c/src/z.rs"), f("pnpm-lock.yaml")];

/** Module a holds logic and tests, b logic, c tests. */
const SPLIT = [f("crates/a/src/x.rs"), f("crates/a/tests/x.rs"), f("crates/b/src/y.rs"), f("crates/c/tests/z.rs"), f("pnpm-lock.yaml")];

/** What a module's row says to a screen reader: its name, its files and each word it shows. */
const said = (name: string) => moduleRow(name).getAttribute("aria-label") ?? "";

const marker = () => within(region()).queryByRole("button", { name: copy.viewed });

const pressed = () => marker()?.getAttribute("aria-pressed");

/** The module's row chosen, as a click on it does. */
const choose = async (name: string, path: string) => {
  take(moduleRow(name));
  await showing(path);
};

it("u7680a_v_and_the_button_mark_the_open_item_and_the_same_press_un_marks_it", async () => {
  await landed(() => ({ files: LOGIC }));
  await choose("crates/a", "crates/a/src/x.rs");
  expect(pressed()).toBe("false");
  expect(said("crates/a")).not.toContain(copy.viewed);

  // V marks it, and the next item opens.
  press("v");
  await showing("crates/b/src/y.rs");
  expect(said("crates/a")).toContain(copy.viewed);

  // The same press un-marks it and moves nothing.
  await choose("crates/a", "crates/a/src/x.rs");
  expect(pressed()).toBe("true");
  press("v");
  await waitFor(() => expect(said("crates/a")).not.toContain(copy.viewed));
  isOpen("crates/a/src/x.rs");
  expect(pressed()).toBe("false");

  // The button marks and un-marks as V does.
  fireEvent.click(within(region()).getByRole("button", { name: copy.viewed }));
  await showing("crates/b/src/y.rs");
  expect(said("crates/a")).toContain(copy.viewed);
  await choose("crates/a", "crates/a/src/x.rs");
  fireEvent.click(within(region()).getByRole("button", { name: copy.viewed }));
  await waitFor(() => expect(said("crates/a")).not.toContain(copy.viewed));
  isOpen("crates/a/src/x.rs");
});

it("u7680a_the_overview_and_a_noise_file_take_no_mark", async () => {
  await landed(() => ({ files: LOGIC }));
  pane();
  expect(marker()).toBeNull();
  press("v");
  pane();
  screen.getByText(copy.viewedProgress(0, 3));

  await takeNoise("pnpm-lock.yaml");
  await showing("pnpm-lock.yaml");
  expect(marker()).toBeNull();
  press("v");
  isOpen("pnpm-lock.yaml");
  screen.getByText(copy.viewedProgress(0, 3));
});

it("u7680a_a_mark_blocks_nothing_and_makes_no_call", async () => {
  const { app } = await landed(() => ({ files: LOGIC }));
  const others = () => app.calls.map(call => call.method).filter(method => method !== "agent.compareFile");

  await choose("crates/a", "crates/a/src/x.rs");
  const before = others();

  press("v");
  await showing("crates/b/src/y.rs");
  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await waitFor(() => expect(said("crates/a")).not.toContain(copy.viewed));
  expect(others()).toEqual(before);
});

it("u7680a_the_header_reads_n_of_m_viewed_then_all_m_viewed", async () => {
  await landed(() => ({ files: [f("crates/a/src/x.rs"), f("crates/b/src/y.rs"), f("pnpm-lock.yaml")] }));
  screen.getByText(copy.viewedProgress(0, 2));
  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await screen.findByText(copy.viewedProgress(1, 2));

  // A find narrows the list and leaves the count as it was.
  press("/");
  fireEvent.input(screen.getByRole("textbox", { name: copy.findFile }), { target: { value: "y.rs" } });
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/b"]));
  screen.getByText(copy.viewedProgress(1, 2));
  press("Escape");
  await waitFor(() => expect(moduleKeys()).toEqual(["m:crates/a", "m:crates/b"]));

  press("v");
  await screen.findByText(copy.viewedProgress(2, 2));

  // A lens with no module says nothing.
  await chooseLens(copy.lenses.tests);
  expect(screen.queryByText(/ viewed$/)).toBeNull();
});

it("u7680b_marking_opens_the_next_unviewed_item_in_the_lens_order", async () => {
  await landed(() => ({ files: LOGIC }));
  await choose("crates/b", "crates/b/src/y.rs");
  press("v");
  await showing("crates/c/src/z.rs");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/c"));

  // A viewed item is skipped: marking a opens c, not b.
  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/c"));
  await showing("crates/c/src/z.rs");
  expect(lensNow()).toBe(copy.lenses.modules);
});

it("u7680b_the_end_of_a_lens_goes_on_to_the_next_lens", async () => {
  await landed(() => ({ files: SPLIT }));

  // Modules ends at c: Logic lists a and b not viewed, so Logic opens at a.
  await choose("crates/c", "crates/c/tests/z.rs");
  press("v");
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.logic));
  await showing("crates/a/src/x.rs");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/a"));

  // Logic ends at b: Tests lists a not viewed (c is), so Tests opens at a.
  press("v");
  await showing("crates/b/src/y.rs");
  press("v");
  await waitFor(() => expect(lensNow()).toBe(copy.lenses.tests));
  await showing("crates/a/tests/x.rs");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/a"));

  // The lens last used follows: the view reopens in it.
  fireEvent.click(closeButton());
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  expect(lensNow()).toBe(copy.lenses.tests);
});

it("u7680b_the_last_mark_leaves_focus_where_it_is", async () => {
  await landed(() => ({ files: LOGIC }));
  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");
  press("v");
  await showing("crates/c/src/z.rs");
  await waitFor(() => expect(treeFocus()).toBe("m:crates/c"));
  press("v");
  await screen.findByText(copy.viewedProgress(3, 3));
  isOpen("crates/c/src/z.rs");
  expect(treeFocus()).toBe("m:crates/c");
  expect(lensNow()).toBe(copy.lenses.modules);
});

it("u7680c_a_mark_made_in_modules_shows_in_logic_and_tests_for_the_same_files", async () => {
  await landed(() => ({ files: SPLIT }));
  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");

  await chooseLens(copy.lenses.logic);
  await waitFor(() => expect(said("crates/a")).toContain(copy.viewed));
  expect(said("crates/b")).not.toContain(copy.viewed);
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(said("crates/a")).toContain(copy.viewed));
  expect(said("crates/c")).not.toContain(copy.viewed);
});

it("u7680c_a_mark_in_logic_marks_only_the_logic_files", async () => {
  await landed(() => ({ files: SPLIT }));
  await chooseLens(copy.lenses.logic);
  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await screen.findByText(copy.viewedProgress(1, 2));

  await chooseLens(copy.lenses.modules);
  await screen.findByText(copy.viewedProgress(0, 3));
  expect(said("crates/a")).not.toContain(copy.viewed);
  await chooseLens(copy.lenses.tests);
  await waitFor(() => expect(said("crates/a")).not.toContain(copy.viewed));
});

/** An Agent with a Worktree, so the switch offers Tree and Branch: Changes lists a and b, Branch lists a (the same blob) and c. */
/** Agent `node` owns `owned`; its Branch changes are a/x.ts and c/y.ts. */
const mountOwned = (node: ReturnType<typeof agent>, owned: OwnedChanges) => mountRail([node], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => owned;
    app.handlers["agent.changedFiles"] = () => ({ files: [f("a/x.ts"), f("c/y.ts")] });
    app.handlers["agent.compareFile"] = ({ path }) => comparison(path);
  });

const withBranch = () => mountOwned(agent("a", "idle", "ready", { worktree: { path: "/w/a", branch: "own/a", base: "main", adopted: false } }), owning([f("a/x.ts"), f("b/x.ts")]));

const openFromRail = async (id = "a", count = 2) => {
  fireEvent.click(await within(rowOf(id)).findByRole("button", { name: copy.changedFiles(count) }));
  await screen.findByRole("region", { name: copy.changes });
};

it("u7680c_reopening_restores_the_marks_and_each_comparison_keeps_its_own", async () => {
  await withBranch();
  await openFromRail();
  await waitFor(() => moduleRow("a"));
  await choose("a", "a/x.ts");
  press("v");
  await showing("b/x.ts");

  // Branch is another comparison: the same file and blob there is not marked.
  fireEvent.click(screen.getByRole("radio", { name: copy.targetBranch }));
  await waitFor(() => moduleRow("c"));
  expect(said("a")).not.toContain(copy.viewed);
  fireEvent.click(screen.getByRole("radio", { name: copy.changes }));
  await waitFor(() => expect(said("a")).toContain(copy.viewed));

  // Closed and opened again, the view keeps them.
  fireEvent.click(closeButton());
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
  await openFromRail();
  await waitFor(() => expect(said("a")).toContain(copy.viewed));
});

it("u7680c_each_group_keeps_its_own_marks", async () => {
  const group = (repo: string, branch: string, files: ChangedFile[]) => ({ repo, branch, base: "main", files });

  await mountOwned(agent("g", "idle", "ready"), { groups: [group("/p", "main", [f("a/x.ts"), f("b/x.ts")]), group("/q", "own/x", [f("a/x.ts"), f("c/y.ts")])] });
  await openFromRail("g", 4);
  await waitFor(() => moduleRow("a"));
  await choose("a", "a/x.ts");
  press("v");
  await showing("b/x.ts");

  // The second group lists the same file with the same blob: it is another comparison.
  const [first, second] = within(screen.getByRole("list", { name: copy.changeGroups })).getAllByRole("button");

  fireEvent.click(there(second));
  await waitFor(() => moduleRow("c"));
  expect(said("a")).not.toContain(copy.viewed);
  fireEvent.click(there(first));
  await waitFor(() => expect(said("a")).toContain(copy.viewed));
});

it("u7680d_an_edit_to_a_viewed_item_un_marks_it_and_says_so", async () => {
  let list = LOGIC;
  const { connected } = await landed(() => ({ files: list }));

  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");

  // The same counts, another blob.
  list = LOGIC.map(file => file.path === "crates/a/src/x.rs" ? f(file.path, "two") : file);
  await connected.owned.refresh("a");
  await waitFor(() => expect(said("crates/a")).toContain(copy.changedSinceViewed));
  expect(said("crates/a")).not.toContain(copy.viewed);
  screen.getByText(copy.viewedProgress(0, 3));
  await choose("crates/a", "crates/a/src/x.rs");
  screen.getByText(copy.changedSinceViewed);
  expect(pressed()).toBe("false");

  // Marked again, the words go.
  press("v");
  await waitFor(() => expect(said("crates/a")).toContain(copy.viewed));
  expect(said("crates/a")).not.toContain(copy.changedSinceViewed);
});

it("u7680d_a_file_that_joins_or_leaves_a_viewed_item_says_nothing", async () => {
  let list = LOGIC;
  const { connected } = await landed(() => ({ files: list }));
  const silent = () => expect(said("crates/a")).not.toMatch(new RegExp(`${copy.viewed}|${copy.changedSinceViewed}`));

  await choose("crates/a", "crates/a/src/x.rs");
  press("v");
  await showing("crates/b/src/y.rs");

  // A file joins: the item reads unviewed.
  list = [...LOGIC, f("crates/a/src/w.rs")];
  await connected.owned.refresh("a");
  await waitFor(() => expect(said("crates/a")).toContain(copy.filesCount(2)));
  silent();

  // The marked file leaves with its module, and comes back unmarked.
  list = LOGIC.slice(1);
  await connected.owned.refresh("a");
  await waitFor(() => expect(moduleKeys()).not.toContain("m:crates/a"));
  list = LOGIC;
  await connected.owned.refresh("a");
  await waitFor(() => expect(moduleKeys()).toContain("m:crates/a"));
  silent();
});
