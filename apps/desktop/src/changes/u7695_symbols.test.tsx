import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { CallPaths } from "@contracts/agent/CallPaths";
import { event } from "../testing/nodes";
import { copy } from "./copy";
import { answers, ALIAS, FLOW_FILES, flowComparison, LOAD, LOOKUP, OTHER, RUN, SHOUT, TYPESCRIPT } from "./flowFixture";
import { take } from "./noteHarness";
import { at, chooseLens, edited, landed, marks, moduleRow, openPaths, region, setUpView, showing, there } from "./viewHarness";

setUpView();

// U7695: the Logic lens lists each item's changed functions and types, over the flow fixture and a fake Daemon that answers `agent.callPaths`.

type Handler = (params: { language?: string | undefined }) => CallPaths;

/** The `agent.callPaths` requests the fake Daemon has had, each as its language, or "lookup". */
const seen: string[] = [];

const serve = (app: Awaited<ReturnType<typeof landed>>["app"], answer: Handler) => {
  seen.length = 0;
  app.handlers["agent.callPaths"] = params => {
    seen.push(params.language ?? "lookup");

    return answer(params);
  };
};

/** `other` is removed and `Alias` is added: the words an entry carries beside its name. */
const MOVED: CallPaths = { ...TYPESCRIPT, symbols: [RUN, { ...OTHER, status: "removed", new: null }, LOAD, { ...ALIAS, status: "added" }] };

/** The view over the Tree target, in Logic. */
const logicOpen = async (handler: Handler = params => params.language === "typescript" ? MOVED : answers()(params)) => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  serve(mounted.app, handler);
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.logic);

  return mounted;
};

const callRows = () => [...region().querySelectorAll<HTMLElement>('[data-row="call"]')];

/** U8032c: what each unfolded row says aloud. */
const rows = () => callRows().map(row => row.getAttribute("aria-label"));

const unfolded = () => waitFor(() => expect(callRows().length).toBeGreaterThan(0));

/** An item opened, with its list open once its trace is done. */
const listed = async (item: string) => {
  take(moduleRow(item));
  await unfolded();
};

it("u7695a_a_logic_item_lists_its_changed_functions_and_types_with_their_kind", async () => {
  await logicOpen();
  take(moduleRow("apps/a"));
  await unfolded();
  expect(rows()).toEqual(["load, function", "run, function", "other, function, Removed", "Alias, type, Added"]);

  // The rows are no lens's: the other lenses have none.
  await chooseLens(copy.lenses.modules);
  await waitFor(() => expect(callRows()).toEqual([]));
});

it("u8032c_the_open_logic_items_row_unfolds_into_its_changed_functions_with_marks", async () => {
  await logicOpen();
  take(moduleRow("apps/a"));
  await unfolded();
  expect(callRows().map(row => row.querySelector(".changes-row-status")?.textContent ?? "")).toEqual(["", "", "−", "+"]);

  // The row says no word for its status; an item that is not open unfolds none.
  expect(callRows().map(row => row.textContent)).toEqual(["load", "run", "other−", "Alias+"]);
  take(moduleRow("crates/b"));
  await showing("crates/b/src/lib.rs");
  expect(callRows()).toEqual([]);
});

it("u7695b_a_language_with_no_server_and_the_changes_target_show_no_entry_and_no_words", async () => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);
  const silent: CallPaths = { languages: [{ language: "typescript", files: 4, server: { found: true, name: "typescript-server" } }, { language: "rust", files: 1, server: { found: false, cause: { kind: "notInstalled", detail: "none" } } }] };

  serve(mounted.app, params => params.language === undefined ? silent : TYPESCRIPT);
  await chooseLens(copy.lenses.logic);
  take(moduleRow("apps/a"));
  await showing("apps/a/src/load.ts");

  // The Changes target has no Worktree to trace: no list, no line, no request.
  expect(callRows()).toEqual([]);
  expect(seen).toEqual([]);

  // The Tree target traces TypeScript; Rust has no server: its item shows nothing.
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(seen).toEqual(["lookup", "typescript"]));
  take(moduleRow("apps/a"));
  await unfolded();
  take(moduleRow("crates/b"));
  await showing("crates/b/src/lib.rs");
  expect(callRows()).toEqual([]);
  expect(region().querySelector("[data-state]")).toBeNull();
});

it("u7695b_rust_says_not_traced_and_trace_adds_its_entries", async () => {
  await logicOpen(answers());
  take(moduleRow("crates/b"));
  await showing("crates/b/src/lib.rs");

  screen.getByText(copy.languageNotTraced("Rust", 1));
  expect(callRows()).toEqual([]);

  // Trace makes the one Rust request; the entry replaces the line.
  fireEvent.click(within(region()).getByRole("button", { name: copy.trace }));
  await unfolded();
  expect(rows()).toEqual([SHOUT.name + ", function"]);
  expect(screen.queryByText(copy.languageNotTraced("Rust", 1))).toBeNull();
  expect(seen).toEqual(["lookup", "typescript", "rust"]);
});

it("u7695b_a_failed_or_dimmed_trace_reads_in_the_item", async () => {
  let failing = true;
  const { app } = await logicOpen(params => params.language === undefined ? LOOKUP : failing ? { state: "failed", cause: { kind: "error", detail: "the server crashed" } } : TYPESCRIPT);

  take(moduleRow("apps/a"));
  await screen.findByText(copy.traceFailed("TypeScript"));
  screen.getByText("the server crashed");

  // Retry asks again; the entries come.
  failing = false;
  fireEvent.click(within(region()).getByRole("button", { name: copy.retry }));
  await unfolded();
  expect(screen.queryByText(copy.traceFailed("TypeScript"))).toBeNull();

  // A write dims the list it was built from.
  edited(app, "a");
  await screen.findByText(copy.changedSinceTraced);
  app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "done", label: "done", since: 0, finished: "1" } } }));
  await waitFor(() => expect(screen.queryByText(copy.changedSinceTraced)).toBeNull());
});

it("u8032c_choosing_an_unfolded_function_focuses_its_first_changed_line_and_hides_nothing", async () => {
  await logicOpen();
  await listed("apps/a");

  const asked = [...seen];

  // `run` spans 1 to 5: the first change in it begins at line 2, where `]` stops on the removed line. `other` is removed: its change is line 20 of the old side.
  const row = (name: string) => there(callRows().find(each => each.textContent?.startsWith(name)));

  fireEvent.click(row(RUN.name));
  await showing(RUN.path);
  await marks(at("old", 2), RUN.path);
  fireEvent.click(row(OTHER.name));
  await marks(at("old", 20), OTHER.path);

  // Choosing makes no request, and every file of the item stays in its scroll.
  expect(seen).toEqual(asked);
  expect(openPaths()).toEqual(expect.arrayContaining([LOAD.path, RUN.path, ALIAS.path]));
});
