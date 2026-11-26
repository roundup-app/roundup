import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Kind } from "@contracts/Kind";
import type { ScanSpots } from "@contracts/agent/ScanSpots";
import type { Spot } from "@contracts/agent/Spot";
import { RpcError } from "../app/seam";
import { event } from "../testing/nodes";
import { copy } from "./copy";
import { answers, FLOW_FILES, flowComparison, OTHER, RUN } from "./flowFixture";
import { flowName } from "./flows";
import { mountControl, WORKTREE } from "./harness";
import { openChanges, openFile, saveNote } from "./noteHarness";
import { calls, chooseLens, comparison, counted, drawn, drawnIn, fresh, landed, moduleKeys, moduleRow, press, setUpView, showing, text } from "./viewHarness";

setUpView();

// U7685: repeats marked in the Changes view's gutter and counted in the item's row, over a fake Daemon that answers `agent.repeatScan`.

const NEW = "pkg/src/new.ts";

const OWNED = "pkg/src/owned.ts";

const hit: Spot = { source: { kind: "repeats" }, path: NEW, start: 6, end: 22, other: { path: OWNED, start: 12, end: 30 }, stale: false };

const FILES = [NEW, "mod/b.ts", "tools/d.ts"].map(path => counted(path, 17, 17));

const lines = (change: (line: number) => string) => Array.from({ length: 40 }, (_, index) => change(index + 1)).join("\n") + "\n";

/** `src/new.ts` changes lines 6 to 22; `src/owned.ts` is a file the listing does not name, read unchanged. */
const read = (path: string): FileComparison => path === OWNED
  ? comparison(path, { status: null, old: text("o", lines(line => `owned ${line}`)), new: text("o", lines(line => `owned ${line}`)) })
  : comparison(path, { old: text("old", lines(line => `line ${line}`)), new: text("new", lines(line => line >= 6 && line <= 22 ? `line ${line} new` : `line ${line}`)) });

const found = (...spots: Spot[]): ScanSpots => ({ spots, complete: true });

const tick = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(yes => { resolve = yes; });

  return { promise, resolve };
};

/** The view over the Tree target, whose scan `scan` answers. */
const treeOpen = async (scan: (n: number) => ScanSpots | Promise<ScanSpots> = () => found(hit), files = FILES, prepare: (app: Awaited<ReturnType<typeof landed>>["app"]) => void = () => undefined) => {
  const mounted = await mountControl(() => ({ files }), fresh());
  let asked = 0;

  mounted.app.handlers["agent.compareFile"] = ({ path }) => read(path);
  mounted.app.handlers["agent.repeatScan"] = () => scan(++asked);
  prepare(mounted.app);
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  return mounted;
};

/** The new-side lines of `path` that carry the repeat stamp. */
const stamped = (path: string) => drawnIn(path).flatMap(each => [...each.shadowRoot?.querySelectorAll('[data-line][data-spot]') ?? []]).map(line => Number(line.getAttribute("data-line")));

const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

const OWNED_LINES = range(12, 30).map(line => `owned ${line}`).join("\n");

const CAUSE = "failed: no such file";

const markName = copy.repeatsAt(copy.repeatPlace(OWNED, 12, 30));

const said = (name: string) => moduleRow(name).getAttribute("aria-label") ?? "";

it("u7685a_a_repeat_is_marked_at_its_lines_and_names_the_other_place", async () => {
  await treeOpen();
  await openFile(NEW);

  await waitFor(() => expect(stamped(NEW)).toEqual(range(6, 22)));
  await screen.findByRole("button", { name: markName });
});

it("u7685b_clicking_the_mark_shows_the_other_place_and_enter_opens_it_in_the_editor", async () => {
  const { app } = await treeOpen();

  await openFile(NEW);
  const place = copy.repeatPlace(OWNED, 12, 30);

  fireEvent.click(await screen.findByRole("button", { name: markName }));
  const shown = within(await screen.findByRole("group", { name: place }));

  await waitFor(() => expect(document.querySelector(".repeat-excerpt")?.textContent).toBe(OWNED_LINES));
  expect(calls(app, "agent.compareFile")).toBeGreaterThan(0);

  // The listing does not name the file, and Enter on the shown place opens it at its first line.
  const user = userEvent.setup();

  shown.getByRole("button", { name: copy.openRepeat(place) }).focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(app.editorCalls).toEqual([{ path: `${WORKTREE.path}/${OWNED}`, line: 12 }]));

  // Another click hides it.
  fireEvent.click(screen.getByRole("button", { name: markName }));
  await waitFor(() => expect(screen.queryByRole("group", { name: place })).toBeNull());
});

it("u7685b_a_failed_read_of_the_other_place_says_its_cause_and_the_next_click_reads_again", async () => {
  const { app } = await treeOpen();
  let missing = true;

  app.handlers["agent.compareFile"] = ({ path }) => {
    if (path === OWNED && missing) throw new RpcError(-32603, CAUSE);

    return read(path);
  };

  await openFile(NEW);

  fireEvent.click(await screen.findByRole("button", { name: markName }));
  await screen.findByText(CAUSE, { exact: false });
  fireEvent.click(screen.getByRole("button", { name: markName }));
  await waitFor(() => expect(screen.queryByRole("group", { name: copy.repeatPlace(OWNED, 12, 30) })).toBeNull());
  missing = false;
  fireEvent.click(screen.getByRole("button", { name: markName }));
  await waitFor(() => expect(document.querySelector(".repeat-excerpt")?.textContent).toBe(OWNED_LINES));
});

it("u7685b_a_place_that_is_not_text_says_there_is_no_text_to_show", async () => {
  const { app } = await treeOpen();

  app.handlers["agent.compareFile"] = ({ path }) => path === OWNED ? comparison(path, { status: null, old: { kind: "binary", revision: "b" }, new: { kind: "binary", revision: "b" } }) : read(path);
  await openFile(NEW);
  fireEvent.click(await screen.findByRole("button", { name: markName }));
  await screen.findByText(copy.noTextToShow);
});

it("u7685c_the_row_counts_its_repeats_and_none_says_nothing", async () => {
  await treeOpen(() => found(hit, { source: { kind: "repeats" }, path: NEW, start: 30, end: 32, other: { path: "mod/b.ts", start: 1, end: 3 }, stale: false }, { source: { kind: "repeats" }, path: "mod/b.ts", start: 3, end: 4, other: { path: NEW, start: 6, end: 7 }, stale: false }));

  await waitFor(() => expect(moduleKeys().map(key => key?.slice(2))).toEqual(["mod", "pkg", "tools"]));
  await waitFor(() => expect(said("pkg")).toContain(copy.repeatsCount(2)));
  expect(said("mod")).toContain(copy.repeatsCount(1));
  expect(said("tools")).not.toMatch(/repeat/);
  expect(moduleRow("tools").textContent).not.toMatch(/repeat/);
});

it("u7685c_a_flow_counts_the_repeats_of_its_sections_and_a_hunk_counts_under_each_flow_that_holds_it", async () => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);
  const lookup = answers();

  mounted.app.handlers["agent.callPaths"] = lookup;
  mounted.app.handlers["agent.repeatScan"] = () => found(
    { source: { kind: "repeats" }, path: "apps/a/src/run.ts", start: 2, end: 2, other: { path: "apps/a/src/load.ts", start: 1, end: 1 }, stale: false },
    { source: { kind: "repeats" }, path: "apps/a/src/load.ts", start: 2, end: 2, other: { path: "apps/a/src/run.ts", start: 1, end: 1 }, stale: false },
    { source: { kind: "repeats" }, path: "crates/b/src/lib.rs", start: 2, end: 2, other: { path: "apps/a/src/run.ts", start: 1, end: 1 }, stale: false },
  );
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.flows);
  await waitFor(() => expect(moduleKeys()).toContain("m:" + flowName(RUN.key)));

  // `load` is under both flows, so its repeat counts under each; Rust is never traced, so its repeat counts under Not traced.
  await waitFor(() => expect(said(flowName(RUN.key))).toContain(copy.repeatsCount(2)));
  expect(said(flowName(OTHER.key))).toContain(copy.repeatsCount(1));
  expect(said("~untraced")).toContain(copy.repeatsCount(1));
  expect(said("~unplaced")).not.toMatch(/repeat/);

  // A section marks only the repeat lines it shows: `run`'s line 2, and the mark names the other place.
  press("j");
  const section = `${RUN.path}\0${RUN.key}`;

  await showing(section);
  await drawn(section);
  await waitFor(() => expect(stamped(section)).toEqual([2]));
  await screen.findByRole("button", { name: copy.repeatsAt(copy.repeatPlace("apps/a/src/load.ts", 1, 1)) });
});

it("u7685d_the_scan_is_asked_after_the_first_paint_on_tree_only_and_never_delays_a_key", async () => {
  const frames: FrameRequestCallback[] = [];
  const never = new Promise<ScanSpots>(() => undefined);
  const mounted = await landed(() => ({ files: [counted("a/x.ts", 1, 1), counted("b/x.ts", 1, 1)] }), read);

  mounted.app.handlers["agent.repeatScan"] = () => never;
  await tick();

  // The Changes target and the Branch target ask nothing.
  expect(calls(mounted.app, "agent.repeatScan")).toBe(0);
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetBranch }));
  await tick();
  expect(calls(mounted.app, "agent.repeatScan")).toBe(0);

  // The Tree target asks only after a frame has painted.
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(frames.length).toBeGreaterThan(0));
  expect(calls(mounted.app, "agent.repeatScan")).toBe(0);
  frames.splice(0).forEach(run => run(0));
  await waitFor(() => expect(calls(mounted.app, "agent.repeatScan")).toBe(1));

  // The scan never answers, and J still opens the first module.
  press("j");
  await showing("a/x.ts");
});

it("u7685e_scanning_partial_failed_and_not_asked_each_say_so_and_done_with_none_says_nothing", async () => {
  // Not asked: the Changes target of an Agent with a Worktree says to choose Tree; an Agent with none says nothing.
  const first = await landed(() => ({ files: FILES }), read);

  await screen.findByText(copy.repeatsNeedTree);
  first.connected.rail.select("plain");
  await waitFor(() => expect(screen.queryByText(copy.repeatsNeedTree)).toBeNull());
  expect(calls(first.app, "agent.repeatScan")).toBe(0);
  document.body.replaceChildren();

  // Scanning: quiet until 150 ms, then the line; done with none leaves no word and no mark.
  const slow = deferred<ScanSpots>();
  const { app } = await treeOpen(() => slow.promise);

  await waitFor(() => expect(calls(app, "agent.repeatScan")).toBe(1));
  expect(screen.queryByText(copy.checkingRepeats)).toBeNull();
  await screen.findByText(copy.checkingRepeats);
  slow.resolve(found());
  await waitFor(() => expect(screen.queryByText(copy.checkingRepeats)).toBeNull());
  expect(screen.queryByText(/repeat/i)).toBeNull();
});

it("u7685e_a_failed_scan_shows_its_cause_and_retry_asks_again_and_a_partial_one_keeps_its_marks", async () => {
  let failing = true;

  const { app } = await treeOpen(() => {
    if (failing) throw new RpcError(-32603, "failed: the scan could not read the Worktree");

    return { spots: [hit], complete: false };
  });

  await screen.findByText(copy.repeatsFailed);
  await screen.findByText("failed: the scan could not read the Worktree", { exact: false });
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await screen.findByText(copy.repeatsPartial);
  expect(screen.queryByText(copy.repeatsFailed)).toBeNull();
  expect(calls(app, "agent.repeatScan")).toBeGreaterThan(1);
  await openFile(NEW);
  await screen.findByRole("button", { name: markName });
});

const status = (kind: Kind) => ({ id: "a", attempt: "1", status_revision: "2", status: { kind, label: kind, since: 0, finished: "1" } });

it("u7685f_a_changed_diff_scans_again_once_and_keeps_the_marks_meanwhile", async () => {
  const second = deferred<ScanSpots>();

  const { app } = await treeOpen(n => n === 2 ? second.promise : found(hit), FILES, ready => {
    ready.handlers["agent.remoteMain"] = () => ({ kind: "moved" });
    ready.handlers["agent.fetchRemoteMain"] = () => ({ commits: 1 });
  });

  const wrote = () => app.emit(event({ name: "agent.toolCall", data: { id: "a", call: { tool: "Edit", arguments: "{}", state: "done", started: 0 } } }));
  const ended = () => app.emit(event({ name: "agent.status", data: status("done") }));


  await openFile(NEW);
  await waitFor(() => expect(stamped(NEW)).toEqual(range(6, 22)));

  // A turn that wrote nothing asks nothing; a turn of two writes asks once.
  ended();
  await tick();
  expect(calls(app, "agent.repeatScan")).toBe(1);
  wrote();
  wrote();
  ended();
  await waitFor(() => expect(calls(app, "agent.repeatScan")).toBe(2));

  // The marks stay while the answer is pending, and a turn that ends meanwhile waits for it.
  expect(stamped(NEW)).toEqual(range(6, 22));
  wrote();
  ended();
  await tick();
  expect(calls(app, "agent.repeatScan")).toBe(2);
  second.resolve(found(hit));
  await waitFor(() => expect(calls(app, "agent.repeatScan")).toBe(3));

  // A Fetch lists again and scans again.
  fireEvent.click(await screen.findByRole("button", { name: copy.fetch }));
  await waitFor(() => expect(calls(app, "agent.repeatScan")).toBe(4));
});

it("u7685g_a_mark_is_read_only_and_its_line_takes_a_note_as_any_line_does", async () => {
  await treeOpen();
  await openFile(NEW);
  await waitFor(() => expect(stamped(NEW)).toEqual(range(6, 22)));

  // The mark's one control shows the other place; none edits, sends or removes.
  expect([...document.querySelectorAll(".repeat-mark button")].map(button => button.textContent)).toEqual([markName]);

  // N on a marked line takes a note that keeps the line, and the marks stay.
  press("]");
  await saveNote("same as owned");
  expect(screen.getByRole("list", { name: copy.notes }).textContent).toMatch(/line 6/i);
  expect(stamped(NEW)).toEqual(range(6, 22));
});
