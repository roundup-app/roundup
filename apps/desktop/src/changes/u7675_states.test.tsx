import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { mountRail, rowOf } from "../rail/railFixture";
import { agent, event } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { COMPARISON, openChanges, saveNote, treeRow } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

/**
 * Every offset the code wrote to each scroller, in order. U7675d and U7675e assert a scroll offset in Vitest, but jsdom lays nothing out
 * (a read of `scrollTop` is only what was last assigned) and the web-assertions lint bars asserting such a read. The offset the code
 * asks for is the behaviour, so these tests assert the writes: a file restored at its offset, a key scrolling to its line, nothing else.
 */
const scrolls = new Map<Element, number[]>();

const offsets = new WeakMap<Element, number>();

const plain = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IdleObserver);
  scrolls.clear();
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) { return offsets.get(this) ?? 0; },
    set(this: Element, top: number) { offsets.set(this, top); scrolls.set(this, [...scrolls.get(this) ?? [], top]); },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (plain) Object.defineProperty(Element.prototype, "scrollTop", plain); else Reflect.deleteProperty(Element.prototype, "scrollTop");
});

/** The value, or a failure naming the missing element. */
const there = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("expected the element to be there");

  return value;
};

/** The offsets written to `scroller`, in order. */
const written = (scroller: Element | null): number[] => scrolls.get(there(scroller)) ?? [];

/** The offset last written to `scroller`. */
const scrolledTo = (scroller: Element | null) => written(scroller).at(-1);

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 1, removed: 1 }, blob: null });

const THREE = [file("a.ts"), file("b.ts"), file("c.ts")];

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const comparison = (path: string, over: Partial<FileComparison> = {}): FileComparison => ({ ...COMPARISON, oldPath: path, newPath: path, ...over });

const SIXTY = Array.from({ length: 60 }, (_, index) => "line " + (index + 1));

/** Three changes: line 3 edited (old 3), a line added after line 20 (new 21), line 45 edited (old 45). */
const CHANGES = [{ side: "old", line: 3 }, { side: "new", line: 21 }, { side: "old", line: 45 }] as const;

const multi = (path: string, revision = "one") => comparison(path, {
  old: text("multi-old", SIXTY.join("\n") + "\n"),
  new: text("multi-" + revision, SIXTY.flatMap((line, index) => index === 2 || index === 44 ? [line + " edited"] : index === 19 ? [line, "added"] : [line]).join("\n") + "\n"),
});

let project = 0;

/** Each test gets its own Project path, so a note one test saves never shows in another. */
const fresh = () => {
  project += 1;

  return "/p" + project;
};

type Listing = { files: ChangedFile[] };

/** Opens the view over `changed`; `answer` reads each file (default: a small change). */
const open = async (changed: () => Listing | Promise<Listing>, answer: (path: string) => FileComparison | Promise<FileComparison> = path => comparison(path)) => {
  const mounted = await mountControl(changed, fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => answer(path);
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });

  return mounted;
};

const region = () => screen.getByRole("region", { name: copy.changes });

const press = (key: string, target: Element = region()) => fireEvent.keyDown(target, { key });

const pane = () => screen.getByLabelText(copy.diff);

const scroller = () => pane().querySelector<HTMLElement>(".diff-content");

/** The path the pane names now: the previous file's until the next file's read lands. */
const openPath = () => pane().querySelector(".diff-path")?.textContent;

const showing = (path: string) => waitFor(() => expect(openPath()).toBe(path));

/** The pane names `path` now. */
const isOpen = (path: string) => { expect(openPath()).toBe(path); };

const lineKinds = () => [...new Set([...scroller()?.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line-type]") ?? []].map(line => line.getAttribute("data-line-type")))];

/** Pierre has drawn the lines of the open file. */
const drawn = () => waitFor(() => expect(lineKinds().length).toBeGreaterThan(0));

const at = (side: "old" | "new", line: number) => copy.selectedLines(side, String(line), true);

/** The pane says `words`. */
const says = (words: string) => waitFor(() => expect(pane().textContent).toContain(words));

const treeShadow = () => [...document.querySelectorAll("file-tree-container")].at(-1)?.shadowRoot ?? null;

const treeFocus = () => treeShadow()?.activeElement?.getAttribute("data-item-path");

/** The query finds nothing. */
const absent = (query: () => HTMLElement | null) => expect(query()).toBeNull();

const gone = (query: () => HTMLElement | null) => waitFor(() => absent(query));

const closeButton = () => screen.getByRole("button", { name: copy.closeChanges });

const calls = (app: { calls: { method: string }[] }, method: string) => app.calls.filter(call => call.method === method).length;

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

const owning = (files: ChangedFile[]): OwnedChanges => ({ groups: [{ repo: "/p", branch: "main", base: "main", files }] });

/** The Rail and the centre over Agents `a` and `b`: `owned` decides what each owns. */
const mountRailWith = (owned: (id: string) => OwnedChanges) => mountRail([agent("a", "idle", "ready"), agent("b", "idle", "ready")], [], () => null, () => false, { pane: fakeEmulators().factory }, [], { name: "p", path: fresh() }, app => {
  app.handlers["agent.ownedChanges"] = ({ id }) => owned(id);
  app.handlers["agent.compareFile"] = ({ path }) => multi(path);
});

/** An Edit of Agent `id` ended: the Rail reads what it owns again. */
const edited = (app: Awaited<ReturnType<typeof mountRailWith>>["app"], id: string) => app.emit(event({ name: "agent.toolCall", data: { id, call: { tool: "Edit", arguments: "{}", state: "done", started: 0 } } }));

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
  const answer = (path: string) => hold && path === "b.ts" ? new Promise<FileComparison>(resolve => { waiting.push(() => resolve(comparison(path))); }) : comparison(path);

  await open(() => ({ files: THREE }), answer);
  await showing("a.ts");
  await drawn();
  hold = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  press("j");
  await vi.advanceTimersByTimeAsync(149);
  absent(() => screen.queryByText(copy.loadingFile("b.ts")));
  isOpen("a.ts");
  await vi.advanceTimersByTimeAsync(1);
  screen.getByText(copy.loadingFile("b.ts"));
  isOpen("a.ts");
  expect(lineKinds().length).toBeGreaterThan(0);
  waiting.splice(0).forEach(each => each());
  vi.useRealTimers();
  await showing("b.ts");
  absent(() => screen.queryByText(copy.loadingFile("b.ts")));

  // A read inside 150 ms never shows the line.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  press("j");
  await vi.advanceTimersByTimeAsync(100);
  absent(() => screen.queryByText(copy.loadingFile("c.ts")));
  vi.useRealTimers();
  await showing("c.ts");
});

it("u7675b_added_deleted_and_renamed_files_say_which", async () => {
  const answers = new Map([
    ["a.ts", comparison("a.ts", { status: "added", old: { kind: "absent", revision: "absent" }, new: text("n", "one\ntwo\n") })],
    ["b.ts", comparison("b.ts", { status: "deleted", old: text("o", "one\ntwo\n"), new: { kind: "absent", revision: "absent" } })],
    ["c.ts", comparison("c.ts", { status: "renamed", oldPath: "old/c.ts" })],
  ]);

  await open(() => ({ files: THREE }), path => there(answers.get(path)));
  await says(copy.statusAdded);
  await waitFor(() => expect(lineKinds()).toEqual(["change-addition"]));
  press("j");
  await says(copy.statusDeleted);
  await waitFor(() => expect(lineKinds()).toEqual(["change-deletion"]));
  await says(at("old", 1));
  press("j");
  await says(copy.renamedPaths("old/c.ts", "c.ts"));
  await waitFor(() => expect(lineKinds()).toEqual(["change-deletion", "change-addition"]));
});

it("u7675b_binary_and_mode_only_files_say_so", async () => {
  const answers = new Map([
    ["a.ts", comparison("a.ts", { old: { kind: "binary", revision: "o" }, new: { kind: "binary", revision: "n" } })],
    ["b.ts", comparison("b.ts", { old: text("o", "same\n"), new: text("n", "same\n") })],
  ]);

  await open(() => ({ files: THREE.slice(0, 2) }), path => there(answers.get(path)));
  await says(copy.binaryDiff);
  absent(() => screen.queryByRole("button", { name: copy.addNote }));
  expect(scroller()).toBeNull();
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
  await says(at("new", 21));
  expect(calls(app, "agent.compareFile")).toBe(1);
  blob = "two";
  await connected.owned.refresh("a");
  await screen.findByText(copy.updatedFile("a"));
  expect(calls(app, "agent.compareFile")).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: copy.reload }));
  await waitFor(() => expect(calls(app, "agent.compareFile")).toBe(2));
  absent(() => screen.queryByText(copy.updatedFile("a")));
  await waitFor(() => expect(scrolledTo(scroller())).toBe(0));
  await says(at("new", 1));
  screen.getByRole("button", { name: copy.editNote(1) });
});

it("u7675c_when_the_open_file_leaves_its_pane_says_so", async () => {
  let list = THREE;
  const { connected } = await open(() => ({ files: list }));

  await showing("a.ts");
  list = THREE.slice(1);
  await connected.owned.refresh("a");
  await screen.findByText(copy.fileGone("a.ts", copy.remoteMain));
  await showing("b.ts");
});

it("u7675c_a_changing_list_leaves_the_trees_focus_and_scroll_alone", async () => {
  // jsdom lays nothing out, so the tree's scroll offset is the critic's: `just capture U7675g` draws it before and after (tree-scrolled, tree-list-changed). What keeps it here is the library contract: a file leaves or arrives by an edit in place, never by resetting the paths.
  const { FileTree } = await import("@pierre/trees");
  const reset = vi.spyOn(FileTree.prototype, "resetPaths");
  const added = vi.spyOn(FileTree.prototype, "add");
  const removed = vi.spyOn(FileTree.prototype, "remove");
  let list = Array.from({ length: 6 }, (_, index) => file("f" + index + ".ts"));
  const { connected } = await open(() => ({ files: list }));
  const row = await treeRow("f3.ts");

  row.focus();
  await showing("f3.ts");

  const counted = (count: number) => waitFor(() => expect(totals()).toContain(copy.changedFiles(count)));

  // A file leaves, then one appears: neither is the focused row, so focus and the open file stay.
  list = list.slice(1);
  await connected.owned.refresh("a");
  await counted(5);
  expect(treeFocus()).toBe("f3.ts");
  list = [...list, file("z.ts")];
  await connected.owned.refresh("a");
  await counted(6);
  expect(treeFocus()).toBe("f3.ts");
  expect(removed).toHaveBeenCalledWith("f0.ts");
  expect(added).toHaveBeenCalledWith("z.ts");
  expect(reset).not.toHaveBeenCalled();
  isOpen("f3.ts");
  absent(() => screen.queryByText(copy.fileGone("f0.ts", copy.remoteMain)));
});

it("u7675c_when_the_open_file_leaves_focus_moves_to_its_neighbour", async () => {
  let list = THREE;
  const { connected } = await open(() => ({ files: list }));

  await showing("a.ts");
  list = THREE.slice(1);
  await connected.owned.refresh("a");
  await screen.findByText(copy.fileGone("a.ts", copy.remoteMain));
  await showing("b.ts");
  await waitFor(() => expect(treeFocus()).toBe("b.ts"));
  press("j");
  await showing("c.ts");

  // The last file leaves: its previous neighbour opens.
  list = THREE.slice(1, 2);
  await connected.owned.refresh("a");
  await screen.findByText(copy.fileGone("c.ts", copy.remoteMain));
  await showing("b.ts");
  await waitFor(() => expect(treeFocus()).toBe("b.ts"));

  // No file is left: focus stays in the view, so Escape still closes it.
  list = [];
  await connected.owned.refresh("a");
  await screen.findByText(copy.noChangesAgainst(copy.remoteMain));
  await waitFor(() => expect(region().contains(document.activeElement)).toBe(true));
  press("Escape", there(document.activeElement));
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
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

it("u7675d_a_file_keeps_its_scroll_and_line_across_switches", async () => {
  let revision = "one";
  const { connected } = await open(() => ({ files: THREE.map(each => ({ ...each, blob: revision })) }), path => multi(path, revision));

  await drawn();
  press("]");
  press("]");
  await says(at("new", 21));
  const kept = scrolledTo(scroller());

  expect(kept).toBeGreaterThan(0);
  press("j");
  await says(at("new", 1));
  expect(scrolledTo(scroller())).toBe(0);
  press("]");
  await says(at("old", 3));
  const other = scrolledTo(scroller());

  press("k");
  await says(at("new", 21));
  expect(scrolledTo(scroller())).toBe(kept);

  // The next change counts from the restored line.
  press("]");
  await says(at("old", 45));
  press("j");
  await says(at("old", 3));
  expect(scrolledTo(scroller())).toBe(other);

  // A file whose blob changed starts at its top after Reload.
  revision = "two";
  await connected.owned.refresh("a");
  await screen.findByText(copy.updatedFile("a"));
  fireEvent.click(screen.getByRole("button", { name: copy.reload }));
  await says(at("new", 1));
  expect(scrolledTo(scroller())).toBe(0);
});

it("u7675e_left_and_right_fold_a_folder", async () => {
  await open(() => ({ files: ["src/a.ts", "src/b.ts", "top.ts"].map(file) }));
  const folder = await treeRow("src/");

  folder.focus();
  press("ArrowLeft", folder);
  await waitFor(() => expect(folder.getAttribute("aria-expanded")).toBe("false"));
  press("ArrowRight", folder);
  await waitFor(() => expect(folder.getAttribute("aria-expanded")).toBe("true"));
});

it("u7675e_tab_moves_from_the_list_to_the_diff", async () => {
  await open(() => ({ files: THREE.slice(0, 2) }), path => multi(path));
  await drawn();
  press("]");
  await says(at("old", 3));
  const row = await treeRow("a.ts");

  row.focus();
  expect(fireEvent.keyDown(row, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(scroller());
  await says(at("old", 3));

  // Tab inside the diff is the browser's own.
  expect(fireEvent.keyDown(there(scroller()), { key: "Tab" })).toBe(true);

  // A file with no focused line lands on its first.
  const next = await treeRow("b.ts");

  next.focus();
  await showing("b.ts");
  await says(at("new", 1));
  expect(fireEvent.keyDown(next, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(scroller());
  await says(at("new", 1));
});

it("u7675e_j_and_k_step_files_from_anywhere", async () => {
  // Tree order: the folder's files first, then the top-level one.
  await open(() => ({ files: ["src/b.ts", "a.ts", "src/a.ts"].map(file) }));
  await showing("src/a.ts");
  const row = await treeRow("src/a.ts");

  row.focus();
  press("j", row);
  await showing("src/b.ts");
  await waitFor(() => expect(treeFocus()).toBe("src/b.ts"));
  await drawn();
  press("j", there(scroller()));
  await showing("a.ts");

  // J stops at the last file, K at the first: the other key then steps once.
  press("j");
  press("k");
  await showing("src/b.ts");
  press("k");
  await showing("src/a.ts");
  press("k");
  press("j");
  await showing("src/b.ts");
});

it("u7675e_bracket_keys_step_changes", async () => {
  await open(() => ({ files: [file("a.ts")] }), path => multi(path));
  await drawn();
  const tops: number[] = [];

  for (const change of CHANGES) {
    press("]");
    await says(at(change.side, change.line));
    tops.push(scrolledTo(scroller()) ?? 0);
  }

  expect(tops).toEqual([...new Set(tops)].sort((left, right) => left - right));

  // ] stops at the last change and [ at the first: the other key then steps once.
  press("]");
  press("[");
  await says(at("new", 21));
  press("[");
  await says(at("old", 3));
  press("[");
  press("]");
  await says(at("new", 21));
  expect(scrolledTo(scroller())).toBe(tops[1]);
});

it("u7675e_question_mark_lists_the_keys", async () => {
  await open(() => ({ files: THREE }));
  await showing("a.ts");
  absent(() => screen.queryByRole("region", { name: copy.keys }));
  press("?");
  const keys = await screen.findByRole("region", { name: copy.keys });
  const items = within(keys).getAllByRole("listitem").map(item => item.textContent ?? "");

  // Up and Down, Left and Right, Tab, J and K, ] and [, Enter, Esc and ?; N, V and R wait for the Issues that build them.
  expect(items).toHaveLength(8);
  expect(items.some(item => /^[NVR]\b/.test(item))).toBe(false);
  press("?");
  await gone(() => screen.queryByRole("region", { name: copy.keys }));
});

it("u7675e_escape_closes_the_keys_list_before_the_view", async () => {
  await open(() => ({ files: THREE }));
  await showing("a.ts");
  press("?");
  await screen.findByRole("region", { name: copy.keys });
  press("Escape");
  await gone(() => screen.queryByRole("region", { name: copy.keys }));
  region();
  press("Escape");
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
});

it("u7675e_keys_do_not_fire_while_typing_in_a_note_field", async () => {
  const { app } = await open(() => ({ files: THREE }));

  await drawn();
  fireEvent.click(screen.getByRole("button", { name: copy.addNote }));
  const box = within(screen.getByRole("form", { name: copy.lineNote })).getByLabelText(copy.note);

  for (const key of ["j", "k", "]", "[", "?"]) press(key, box);
  await says(at("new", 1));
  absent(() => screen.queryByRole("region", { name: copy.keys }));
  isOpen("a.ts");
  expect(calls(app, "agent.compareFile")).toBe(1);

  // Escape belongs to the field too: the view stays.
  press("Escape", box);
  region();
});

it("u7675f_reopening_restores_the_open_file_its_scroll_and_line", async () => {
  let list = THREE;
  const { app } = await mountRailWith(id => owning(id === "a" ? list : [file("other.ts")]));
  const icon = () => within(rowOf("a")).findByRole("button", { name: copy.changedFiles(list.length) });
  const opener = await icon();

  fireEvent.click(opener);
  await showing("a.ts");
  press("j");
  await showing("b.ts");
  await drawn();
  await says(at("new", 1));
  press("]");
  press("]");
  await says(at("new", 21));
  const kept = scrolledTo(scroller());

  // Closing returns focus to the Rail icon; reopening restores the file, its scroll and line, with focus in the tree.
  fireEvent.click(closeButton());
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
  fireEvent.click(opener);
  await showing("b.ts");
  await says(at("new", 21));
  expect(scrolledTo(scroller())).toBe(kept);
  await waitFor(() => expect(treeFocus()).toBe("b.ts"));

  // Another Agent keeps its own place, and this one's is still here when it returns.
  fireEvent.click(rowOf("b"));
  await showing("other.ts");
  fireEvent.click(rowOf("a"));
  await showing("b.ts");
  await says(at("new", 21));
  expect(scrolledTo(scroller())).toBe(kept);

  // The open file is restored only while it is still listed.
  fireEvent.click(closeButton());
  await gone(() => screen.queryByRole("region", { name: copy.changes }));
  list = [file("a.ts"), file("c.ts")];
  edited(app, "a");
  fireEvent.click(await icon());
  await showing("a.ts");
});
