import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import * as diff from "diff";
import { expect, it, vi } from "vitest";
import type { CallPaths } from "@contracts/agent/CallPaths";
import type { Kind } from "@contracts/Kind";
import { event } from "../testing/nodes";
import { copy } from "./copy";
import { keepHunks } from "./diffDraw";
import { answers, FLOW_FILES, flowComparison, LOAD, LOOKUP, OTHER, RUN, RUST, SHOUT, ALIAS, TYPES_ONLY, TYPESCRIPT } from "./flowFixture";
import { flowName, groupFlows } from "./flows";
import { saveNote, take, treeRow } from "./noteHarness";
import { tabNamed, chooseLens, drawnIn, edited, landed, lensGroup, moduleKeys, moduleRow, openPaths, pane, press, region, section, setUpView, showing, slot } from "./viewHarness";

setUpView();

// U7683: the Flows lens, over the flow fixture and a fake Daemon that answers `agent.callPaths`.

type Handler = (params: { language?: string | undefined; to?: "tree" | "branch" | undefined }) => CallPaths | Promise<CallPaths>;

/** The `agent.callPaths` requests the fake Daemon has had, each as its language, or "lookup". */
const seen: string[] = [];

const asked = () => [...seen];

const serve = (app: Awaited<ReturnType<typeof landed>>["app"], answer: Handler) => {
  seen.length = 0;
  app.handlers["agent.callPaths"] = params => {
    seen.push(params.language ?? "lookup");

    return answer(params);
  };
};

const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(yes => { resolve = yes; });

  return { promise, resolve };
};

/** The view over the Tree target, in Flows. */
const flowsOpen = async (handler: Handler = answers()) => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  serve(mounted.app, handler);
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.flows);

  return mounted;
};

const flowKey = (entry: { key: string }) => "m:" + flowName(entry.key);

const traced = () => waitFor(() => expect(moduleKeys()).toContain(flowKey(RUN)));

const labels = () => [...slot()?.querySelectorAll(".module-function") ?? []].map(each => each.textContent);

const said = (entry: { key: string }) => moduleRow(flowName(entry.key)).getAttribute("aria-label") ?? "";

const sectionOf = (symbol: { path: string; key: string }) => symbol.path + "\0" + symbol.key;

/** The new-side lines Pierre drew as added in a section. */
const added = (id: string) => drawnIn(id).flatMap(each => [...each.shadowRoot?.querySelectorAll('[data-line-type="change-addition"][data-line]') ?? []]).map(line => Number(line.getAttribute("data-line")));

const status = (kind: Kind) => ({ id: "a", attempt: "1", status_revision: "2", status: { kind, label: kind, since: 0, finished: "1" } });

it("u7683a_the_flows_overview_lists_the_flows_in_list_order", async () => {
  await flowsOpen();

  const keys = [flowKey(RUN), flowKey(OTHER), "m:~unplaced", "m:~untraced"];

  await waitFor(() => expect(moduleKeys()).toEqual(keys));
  expect([...pane().querySelectorAll<HTMLElement>("[data-entry]")].map(row => row.dataset.entry)).toEqual(keys);
  expect(within(pane()).getAllByText(copy.filesCount(2))).toHaveLength(3);

  // J opens the first flow, as it opens a module.
  press("j");
  await showing(sectionOf(RUN));
});

it("u7683b_opening_the_view_asks_the_lookup_once_and_traces_typescript_once_and_rust_never", async () => {
  const { app } = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  serve(app, answers());
  await chooseLens(copy.lenses.flows);

  // The listing has no owned group to read through: nothing is asked.
  await tick();
  expect(asked()).toEqual([]);

  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript"]));
  await traced();
  await tick();
  expect(asked()).toEqual(["lookup", "typescript"]);
});

it("u7683b_a_write_dims_the_flows_and_a_turn_end_traces_typescript_again_once_and_rust_never", async () => {
  const { app } = await flowsOpen();
  const dim = () => region().querySelector('[data-state="dim"]');

  await traced();

  // A write dims the flows and asks nothing.
  edited(app, "a");
  await waitFor(() => expect(dim()).not.toBeNull());
  await tick();
  expect(asked()).toEqual(["lookup", "typescript"]);

  // The turn's end traces TypeScript once; a later turn with no write asks nothing.
  app.emit(event({ name: "agent.status", data: status("done") }));
  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript", "typescript"]));
  await waitFor(() => expect(dim()).toBeNull());
  app.emit(event({ name: "agent.status", data: status("idle") }));
  await tick();
  expect(asked()).toHaveLength(3);
});

it("u7683b_a_write_dims_a_traced_rust_and_offers_trace_and_a_turn_end_never_traces_it", async () => {
  const { app } = await flowsOpen();

  await traced();
  fireEvent.click(within(region()).getByRole("button", { name: copy.trace }));
  await waitFor(() => expect(moduleKeys()).toContain(flowKey({ key: SHOUT.key })));

  edited(app, "a");
  await waitFor(() => expect(screen.getAllByText(copy.changedSinceTraced)).toHaveLength(2));

  // The turn's end traces TypeScript again and Rust not at all; Trace asks for Rust once more.
  app.emit(event({ name: "agent.status", data: status("done") }));
  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript", "rust", "typescript"]));
  await tick();
  expect(asked()).toEqual(["lookup", "typescript", "rust", "typescript"]);
  expect(screen.getAllByText(copy.changedSinceTraced)).toHaveLength(1);

  fireEvent.click(within(region()).getByRole("button", { name: copy.trace }));
  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript", "rust", "typescript", "rust"]));
});

it("u7683b_a_new_to_value_drops_the_old_answer_and_traces_typescript_again", async () => {
  const slow = deferred<CallPaths>();

  await flowsOpen(({ language, to }) => language === "typescript" ? to === "tree" ? slow.promise : TYPES_ONLY : LOOKUP);

  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript"]));
  fireEvent.click(screen.getByRole("radio", { name: copy.targetBranch }));
  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript", "lookup", "typescript"]));

  // The Branch answer holds no entry point; the Tree answer, arriving late, is ignored.
  await waitFor(() => expect(moduleKeys()).toEqual(["m:~unplaced", "m:~untraced"]));
  slow.resolve(TYPESCRIPT);
  await tick();
  expect(moduleKeys()).toEqual(["m:~unplaced", "m:~untraced"]);
});

it("u7683c_flows_are_named_in_path_order_then_unplaced_then_not_traced_then_noise", () => {
  const items = (...done: Parameters<typeof groupFlows>[1][number][]) => groupFlows(FLOW_FILES, done).modules.map(item => [item.label, item.files.map(file => file.path)]);

  expect(items(TYPESCRIPT)).toEqual([
    ["run", ["apps/a/src/run.ts", "apps/a/src/load.ts"]],
    ["other", ["apps/a/src/run.ts", "apps/a/src/load.ts"]],
    ["Unplaced", ["apps/a/src/types.ts"]],
    ["Not traced", ["crates/b/src/lib.rs", "docs/README.md"]],
  ]);
  expect(groupFlows(FLOW_FILES, [TYPESCRIPT]).noise.flatMap(row => row.files.map(file => file.path))).toEqual(["pnpm-lock.yaml"]);

  // A done Rust answer takes its file out of Not traced and adds its flow after TypeScript's.
  expect(items(TYPESCRIPT, RUST).map(([label]) => label)).toEqual(["run", "other", "shout", "Unplaced", "Not traced"]);

  // No callable symbol changed: no flow, and every file a symbol does not name stays Not traced.
  expect(items(TYPES_ONLY)).toEqual([
    ["Unplaced", [ALIAS.path]],
    ["Not traced", ["apps/a/src/load.ts", "apps/a/src/run.ts", "crates/b/src/lib.rs", "docs/README.md"]],
  ]);
});

it("u7923a_a_hunk_outside_every_function_sits_under_unplaced_though_its_functions_are_in_flows", async () => {
  // Line 12 of run.ts sits in neither `run` (1 to 5) nor `other` (18 to 22).
  const mounted = await landed(() => ({ files: FLOW_FILES }), path => flowComparison(path, path === RUN.path ? [2, 12] : [2]));

  serve(mounted.app, answers());
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.flows);
  await waitFor(() => expect(moduleKeys()).toContain("m:~unplaced"));

  // Counts: run.ts joins types.ts under Unplaced.
  await waitFor(() => expect(moduleRow("~unplaced").getAttribute("aria-label")).toContain(copy.filesCount(2)));

  take(moduleRow("~unplaced"));
  await waitFor(() => expect(openPaths()).toContain(RUN.path));
  await waitFor(() => expect(added(RUN.path)).toEqual([12]));

  // Viewed: Unplaced reads viewed once marked.
  press("v");
  await waitFor(() => expect(moduleRow("~unplaced").getAttribute("aria-label")).toContain(copy.viewed));
});

it("u7683d_a_flow_opens_its_sections_in_call_order_each_with_only_the_hunks_that_hold_its_function", async () => {
  await flowsOpen();
  await traced();

  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(labels()).toEqual(["run", "load"]));
  await waitFor(() => expect(added(sectionOf(RUN))).toEqual([2]));

  take(moduleRow(flowName(OTHER.key)));
  await waitFor(() => expect(labels()).toEqual(["other", "load"]));
  await waitFor(() => expect(added(sectionOf(OTHER))).toEqual([20]));

  // A file row under a flow opens that flow's scroll: load.ts sits under both.
  await treeRow(LOAD.path);
  take([...region().querySelectorAll<HTMLElement>('[data-row="file"]')].filter(row => row.dataset.path === LOAD.path)[0] ?? region());
  await waitFor(() => expect(labels()).toEqual(["run", "load"]));
  expect(openPaths()).toContain(sectionOf(LOAD));
});

it("u7683d_a_note_in_a_flow_draws_in_the_section_that_holds_its_line", async () => {
  await flowsOpen();
  await traced();
  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(added(sectionOf(RUN))).toEqual([2]));
  const note = "check this";

  await saveNote(note);

  const text = (id: string) => section(id)?.textContent ?? "";

  // The note is on run.ts line 1, a line only run's section holds: it draws there once and not under load.
  expect(text(sectionOf(RUN)).split(note)).toHaveLength(2);
  expect(text(sectionOf(LOAD)).split(note)).toHaveLength(1);
});

it("u7683d_a_section_keeps_only_the_hunks_with_a_changed_line_its_function_holds", () => {
  const body = (line: (number: number) => string) => Array.from({ length: 25 }, (_, index) => line(index + 1)).join("\n") + "\n";
  const patch = diff.createTwoFilesPatch("a.ts", "a.ts", body(number => "line " + number), body(number => number === 2 || number === 20 ? "line " + number + " new" : "line " + number));
  const hunks = (text: string) => text.split("\n").filter(line => line.startsWith("@@")).length;
  const kept = keepHunks(patch, (side, line) => side === "new" && line >= 18, diff);

  expect(hunks(patch)).toBe(2);
  expect(hunks(kept)).toBe(1);
  expect(kept).not.toContain("line 2 new");

  // A function whose lines no hunk changed leaves the patch whole.
  expect(keepHunks(patch, () => false, diff)).toBe(patch);
});

it("u7683e_the_call_tree_marks_added_removed_and_changed_calls_folds_the_rest_and_a_row_opens_its_section", async () => {
  const { app } = await flowsOpen();
  const rows = () => [...region().querySelectorAll<HTMLElement>('[data-row="call"]')];
  const read = (path: string) => app.calls.filter(call => call.method === "agent.compareFile" && JSON.stringify(call.params).includes(path)).length;

  await traced();
  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(rows().map(row => row.textContent)).toEqual(["runChanged", "loadChanged", copy.calledBy(3), "legacyRemoved", copy.unchangedCalls(1)]));

  // A call opens the section of the function it calls, once, beside the one read that looks for hunks outside every function (U7923a).
  await waitFor(() => expect(read(LOAD.path)).toBe(1));
  fireEvent.click(rows()[1] ?? region());
  await waitFor(() => expect(read(LOAD.path)).toBe(2));
});

it("u7683f_tracing_shows_after_150_ms_a_failed_trace_says_why_and_retry_asks_again", async () => {
  const slow = deferred<CallPaths>();

  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  serve(mounted.app, ({ language }) => language === "typescript" ? slow.promise : LOOKUP);
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.click(lensGroup().getByRole("radio", { name: tabNamed(copy.lenses.flows) }));
  await vi.advanceTimersByTimeAsync(149);
  expect(asked()).toEqual(["lookup", "typescript"]);
  expect(screen.queryByText(copy.tracing("TypeScript"))).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  screen.getByText(copy.tracing("TypeScript"));
  vi.useRealTimers();

  // Keys work while it runs.
  press("j");
  await showing("apps/a/src/load.ts");

  slow.resolve({ state: "failed", cause: { kind: "error", detail: "the server crashed" } });
  await screen.findByText(copy.traceFailed("TypeScript"));
  screen.getByText("the server crashed");
  expect(screen.queryByText(copy.tracing("TypeScript"))).toBeNull();

  fireEvent.click(within(region()).getByRole("button", { name: copy.retry }));
  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript", "typescript"]));
});

it("u7683f_rust_and_a_language_with_no_server_say_so_and_trace_moves_the_rust_files_into_flows", async () => {
  await flowsOpen();

  await traced();

  // The lookup names counts and no files; a language with no server starts nothing.
  screen.getByText(copy.languageNotTraced("Rust", 1));
  screen.getByText(copy.noServer("Python", 2));
  expect(asked()).toEqual(["lookup", "typescript"]);
  expect(groupFlows(FLOW_FILES, [TYPESCRIPT]).modules.at(-1)?.files.map(file => file.path)).toContain("crates/b/src/lib.rs");

  fireEvent.click(within(region()).getByRole("button", { name: copy.trace }));
  await waitFor(() => expect(asked()).toEqual(["lookup", "typescript", "rust"]));
  await waitFor(() => expect(moduleKeys()).toContain(flowKey({ key: RUST.symbols[0]?.key ?? "" })));
  expect(screen.queryByText(copy.languageNotTraced("Rust", 1))).toBeNull();

  // A function that makes no call ends its tree there.
  take(moduleRow(flowName(SHOUT.key)));
  await waitFor(() => expect([...region().querySelectorAll('[data-row="call"]')].map(row => row.textContent)).toEqual(["shoutChanged", copy.endsHere]));
});

it("u7683g_marking_a_flow_viewed_opens_the_next_unviewed_flow_and_a_shared_file_reads_viewed_in_both", async () => {
  await flowsOpen();
  await traced();

  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(labels()).toEqual(["run", "load"]));
  press("v");

  // run and other list the same two files, so marking one marks both; the next unviewed item opens.
  await waitFor(() => expect(said(RUN)).toContain(copy.viewed));
  expect(said(OTHER)).toContain(copy.viewed);
  await showing(ALIAS.path);
});
