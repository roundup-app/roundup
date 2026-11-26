import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { Account } from "@contracts/agent/Account";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Gap } from "@contracts/agent/Gap";
import type { Readback } from "@contracts/agent/Readback";
import { event } from "../testing/nodes";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges } from "./noteHarness";
import { parseDiagram } from "./diagram";
import { answers, FLOW_FILES, flowComparison, RUN } from "./flowFixture";
import { flowName } from "./flows";
import { calls, chooseLens, comparison, counted, drawn, drawnIn, edited, fresh, landed, moduleKeys, moduleRow, pane, press, setUpView, showing, text } from "./viewHarness";

setUpView();

// U7688: the readback the Overview carries, its states, its gaps and its diagram, over a fake Daemon that answers `agent.readback` and `agent.readbackStart`.

const NEW = "pkg/src/new.ts";

const FILES = [NEW, "mod/b.ts", "tools/d.ts"].map(path => counted(path, 17, 17));

const lines = (change: (line: number) => string) => Array.from({ length: 40 }, (_, index) => change(index + 1)).join("\n") + "\n";

const read = (path: string): FileComparison => comparison(path, { old: text("old", lines(line => `line ${line}`)), new: text("new", lines(line => line >= 6 && line <= 22 ? `line ${line} new` : `line ${line}`)) });

const CAUSE = "the model answered in prose";

const GAP: Gap = { path: NEW, said: "added a retry", quote: "line 10 new", line: 10 };

const account = (over: Partial<Account> = {}): Account => ({ overview: "Adds a loader and wires it into run.", diagram: "Before\nrun -> load\nAfter\nrun -> cache -> load", flows: [], modules: [{ module: "pkg", account: "Loads data through a cache." }], unplaced: [], ranks: [], risks: [], explanations: [], gaps: [GAP], ...over });

const result = (state: "read" | "stale", over: Partial<Account> = {}): Readback => ({ state, ...account(over) });

type Answering = { state: Readback };

/** The view over the Tree target, whose Daemon holds `answer.state`; `agent.readbackStart` moves it to reading. */
const treeOpen = async (answer: Answering) => {
  const mounted = await mountControl(() => ({ files: FILES }), fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => read(path);
  mounted.app.handlers["agent.readback"] = () => answer.state;
  mounted.app.handlers["agent.readbackStart"] = () => {
    answer.state = { state: "reading" };

    return answer.state;
  };

  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  return mounted;
};

const starts = (app: { calls: { method: string }[] }) => calls(app, "agent.readbackStart");

const tick = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));

const startButton = () => screen.findByRole("button", { name: copy.readBack });

it("u7688a_only_the_user_starts_a_readback_and_a_comparison_without_a_tree_offers_none", async () => {
  const { app } = await treeOpen({ state: { state: "notRead" } });

  await startButton();
  expect(within(pane()).getByText(copy.readbackQuiet)).toBeTruthy();

  // A write turn ends, and the listing is read again: nothing starts a run.
  edited(app, "a");
  app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "done", label: "done", since: 0, finished: "1" } } }));
  await tick();
  expect(starts(app)).toBe(0);

  // R and the button start one, and a second ask while it reads starts none.
  press("r");
  await screen.findByText(copy.readingBack);
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  press("r");
  expect(starts(app)).toBe(1);
  expect(app.calls.find(call => call.method === "agent.readbackStart")?.params).toEqual({ id: "a", to: "tree" });

  fireEvent.click(screen.getByRole("radio", { name: copy.changes }));
  expect(await screen.findByText(copy.readbackNeedsTree)).toBeTruthy();
  expect(screen.queryByRole("button", { name: copy.readBack })).toBeNull();
});

it("u7688b_a_kept_result_shows_on_open_and_starts_no_run", async () => {
  const answer: Answering = { state: result("read") };
  const { app } = await treeOpen(answer);

  expect(await screen.findByText(copy.readbackCredit)).toBeTruthy();
  expect(starts(app)).toBe(0);
  expect(await screen.findByText(account().overview)).toBeTruthy();
});

it("u7688b_a_running_readback_keeps_the_view_usable_and_shows_its_result_when_it_ends", async () => {
  const answer: Answering = { state: { state: "notRead" } };

  await treeOpen(answer);
  fireEvent.click(await startButton());
  await screen.findByText(copy.readingBack);
  expect(moduleRow("pkg")).toBeTruthy();

  answer.state = result("read");
  expect(await screen.findByText(account().overview, {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.queryByText(copy.readingBack)).toBeNull();
});

const turnEnds = (app: { emit: (value: ReturnType<typeof event>) => void }) => app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "done", label: "done", since: 0, finished: "1" } } }));

it("u7688b_a_write_makes_the_read_stale_dimmed_and_read_back_again_runs_again", async () => {
  const answer: Answering = { state: result("read") };
  const { app } = await treeOpen(answer);

  await screen.findByText(copy.readbackCredit);
  expect(pane().querySelector('[data-stale="true"]')).toBeNull();

  // The turn wrote a file, and the Daemon now says the diff moved under the result.
  answer.state = result("stale");
  edited(app, "a");
  turnEnds(app);

  expect(await screen.findByText(copy.changedSinceReadback, { exact: false })).toBeTruthy();
  expect(pane().querySelector('[data-stale="true"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: copy.readBackAgain }));
  expect(await screen.findByText(copy.readingBack)).toBeTruthy();
  expect(starts(app)).toBe(1);
});

it("u7688b_a_failed_readback_says_why_and_retries", async () => {
  const answer: Answering = { state: { state: "failed", kind: "badAnswer", cause: CAUSE } };
  const { app } = await treeOpen(answer);

  await screen.findByText(copy.readbackFailed, { exact: false });
  expect(pane().querySelector(".flow-cause")?.textContent).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await screen.findByText(copy.readingBack);
  expect(starts(app)).toBe(1);
});

it("u7688c_the_diagram_reads_its_calls_as_words_and_a_failed_comparison_keeps_the_account", async () => {
  await treeOpen({ state: result("read", { gaps: { failed: "the model timed out" } }) });

  const list = await screen.findByRole("figure", { name: copy.diagram });

  // One figure for each of the two panels, laid out by the library.
  await waitFor(() => expect(list.querySelectorAll("svg.readback-figure")).toHaveLength(2), { timeout: 5000 });
  expect(within(list).getAllByText(copy.diagramBefore)).toHaveLength(1);
  expect(within(list).getByText(copy.diagramCalls("run", "load"))).toBeTruthy();
  expect(within(list).getByText(copy.diagramCalls("cache", "load"))).toBeTruthy();
  expect(screen.getByText(copy.gapsNotCompared("a"), { exact: false })).toBeTruthy();
  expect(pane().querySelector(".flow-cause")?.textContent).toBeTruthy();
  expect(screen.getByText(account().overview)).toBeTruthy();
});

it("u7688c_a_diagram_with_no_call_shows_as_text", () => {
  expect(parseDiagram("The loader feeds the cache.")).toEqual([{ label: undefined, calls: [], words: ["The loader feeds the cache."] }]);
  expect(parseDiagram("A => B\nB → C")[0]?.calls).toEqual([["A", "B"], ["B", "C"]]);
});

it("u7688d_a_module_opens_with_its_account_and_else_says_it_has_none", async () => {
  await treeOpen({ state: result("read") });

  await screen.findByText(copy.readbackCredit);
  fireEvent.click(moduleRow("pkg"));
  await showing(NEW);
  await waitFor(() => expect(document.querySelector(".module-account")?.textContent).toBeTruthy());
  expect(document.querySelector(".module-account")?.textContent).not.toBe(copy.noModuleAccount);

  fireEvent.click(moduleRow("mod"));
  await showing("mod/b.ts");
  expect(await screen.findByText(copy.noModuleAccount)).toBeTruthy();
  expect(document.querySelector(".module-account")?.textContent).toBe(copy.noModuleAccount);
});

it("u7688e_a_gap_marks_its_line_counts_in_its_row_and_links_from_the_overview", async () => {
  await treeOpen({ state: result("read", { gaps: [GAP, { ...GAP, said: "dropped a file", path: "gone.ts", line: 3 }] }) });

  const open = await screen.findByRole("button", { name: copy.openGap(copy.repeatPlace(NEW, 10, 10)) });

  expect(moduleRow("pkg").getAttribute("aria-label")).toContain(copy.gapsCount(1));

  // A gap whose file the listing no longer names has no link.
  expect(screen.queryByRole("button", { name: copy.openGap(copy.repeatPlace("gone.ts", 3, 3)) })).toBeNull();
  expect(screen.getByText(/dropped a file/)).toBeTruthy();

  fireEvent.click(open);
  await showing(NEW);
  await waitFor(() => expect(drawnIn(NEW).length).toBeGreaterThan(0));
  expect(await screen.findByText(copy.gapSaid("a", GAP.said))).toBeTruthy();
  expect(screen.getByText(copy.gapDiff(GAP.quote))).toBeTruthy();
});

it("u7688e_a_flow_row_counts_its_gaps", async () => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  mounted.app.handlers["agent.callPaths"] = answers();
  mounted.app.handlers["agent.readback"] = () => result("read", { gaps: [{ path: "apps/a/src/load.ts", said: "x", quote: "line 2 new", line: 2 }] });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.flows);
  await waitFor(() => expect(moduleKeys()).toContain("m:" + flowName(RUN.key)));

  // `load` sits under both flows, so its gap counts under each.
  await waitFor(() => expect(moduleRow(flowName(RUN.key)).getAttribute("aria-label")).toContain(copy.gapsCount(1)));
});

it("u7688e_a_stale_result_draws_no_gap_and_counts_none", async () => {
  await treeOpen({ state: result("stale") });

  await screen.findByText(copy.changedSinceReadback, { exact: false });

  // The dimmed list keeps the gap; no row counts it and no diff draws it.
  expect(screen.getByRole("button", { name: copy.openGap(copy.repeatPlace(NEW, 10, 10)) })).toBeTruthy();
  expect(moduleRow("pkg").getAttribute("aria-label")).not.toContain(copy.gapsCount(1));
  fireEvent.click(moduleRow("pkg"));
  await showing(NEW);
  await drawn(NEW);
  expect(screen.queryByText(copy.gapDiff(GAP.quote))).toBeNull();
});
