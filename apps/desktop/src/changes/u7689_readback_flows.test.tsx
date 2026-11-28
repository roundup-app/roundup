import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { Account } from "@contracts/agent/Account";
import type { ReadFlow } from "@contracts/agent/ReadFlow";
import type { Readback } from "@contracts/agent/Readback";
import { copy } from "./copy";
import { answers, FLOW_FILES, flowComparison, OTHER, RUN, SHOUT, TYPESCRIPT } from "./flowFixture";
import { flowName, groupFlows } from "./flows";
import { openOverview, take } from "./noteHarness";
import { calls, chooseLens, landed, moduleKeys, moduleRow, openPaths, press, region, setUpView, showViewedRows, showing, slot } from "./viewHarness";

setUpView();

// U7689: the Flows lens after a readback, over the flow fixture and a fake Daemon that answers `agent.callPaths` and `agent.readback`.

const RUN_TS = "apps/a/src/run.ts";

const LOAD_TS = "apps/a/src/load.ts";

const TYPES_TS = "apps/a/src/types.ts";

const LIB_RS = "crates/b/src/lib.rs";

const README = "docs/README.md";

const step = (note: string, ...hunks: string[]) => ({ note, hunks });

const RUN_FLOW: ReadFlow = { id: "code-1", name: "Run loads the data", source: "code", steps: [step("Load reads the data.", `${LOAD_TS}#1`), step("Run asks load for it.", `${RUN_TS}#1`)] };

const OTHER_FLOW: ReadFlow = { id: "code-2", name: "Other loads it too", source: "code", steps: [step("Other calls load.", `${RUN_TS}#2`), step("Load reads the data.", `${LOAD_TS}#1`)] };

const ADDED: ReadFlow = { id: "added-1", name: "Shout is checked", source: "readback", steps: [step("Shout upcases its input.", `${LIB_RS}#1`)] };

const account = (over: Partial<Account> = {}): Account => ({ overview: "Adds a loader.", diagram: "", flows: [RUN_FLOW, OTHER_FLOW, ADDED], modules: [], unplaced: [`${TYPES_TS}#1`, `${README}#1`], ranks: [], risks: [], explanations: [], stops: [], gaps: [], ...over });

const result = (state: "read" | "stale", over: Partial<Account> = {}): Readback => ({ state, ...account(over) });

type Answering = { state: Readback };

const flowKey = (entry: { key: string }) => "m:" + flowName(entry.key);

const tick = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

/** The view over the Tree target, in Flows, whose Daemon holds `answer.state`; `agent.readbackStart` moves it to reading. */
const flowsRead = async (answer: Answering, target: "tree" | "changes" = "tree") => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  mounted.app.handlers["agent.callPaths"] = answers();
  mounted.app.handlers["agent.readback"] = () => answer.state;
  mounted.app.handlers["agent.readbackStart"] = () => {
    answer.state = { state: "reading" };

    return answer.state;
  };

  if (target === "tree") fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.flows);

  return mounted;
};

const said = (name: string) => moduleRow(name).getAttribute("aria-label") ?? "";

const labels = () => [...slot()?.querySelectorAll(".module-function") ?? []].map(each => each.textContent);

/** The element a test needs, or a loud failure when the view has not drawn it. */
const need = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("the view has not drawn this yet");

  return value;
};

const states = () => need(region().querySelector<HTMLElement>(".flow-states"));

const inSlot = () => need(slot());

const NAMES = [flowKey(RUN), flowKey(OTHER), "m:~read:added-1", "m:~unplaced"];

it("u7689a_a_code_flow_gains_the_readbacks_name_and_explanation_and_keeps_what_the_code_found", async () => {
  await flowsRead({ state: result("read") });
  await waitFor(() => expect(moduleKeys()).toEqual(NAMES));

  // The row says the readback's name and keeps the function as a quiet second line.
  expect(said(flowName(RUN.key))).toContain(RUN_FLOW.name);
  expect(moduleRow(flowName(RUN.key)).querySelector(".changes-row-function")?.textContent).toContain(RUN.name);
  expect(said(flowName(OTHER.key))).toContain(OTHER_FLOW.name);

  // The open flow's header credits the readback and lists its notes; the sections stay in the trace's call order though the readback listed load first.
  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(labels()).toEqual(["run", "load"]));
  expect(inSlot().querySelector(".flow-account .readback-credit")?.textContent).toBe(copy.readbackCredit);
  expect([...inSlot().querySelectorAll(".flow-account li")].map(each => each.textContent)).toEqual(RUN_FLOW.steps.map(each => each.note));
  expect(region().querySelectorAll('.changes-tree [data-row="call"]').length).toBeGreaterThan(0);
});

it("u7689a_a_name_applies_only_when_the_readbacks_hunks_name_the_flows_files", () => {
  const named = (flows: ReadFlow[]) => groupFlows(FLOW_FILES, [TYPESCRIPT], { account: account({ flows }), stale: false }).modules.slice(0, 2).map(item => [item.label, item.function]);

  expect(named([RUN_FLOW, OTHER_FLOW])).toEqual([["Run loads the data", "run"], ["Other loads it too", "other"]]);

  // code-1's hunks sit in a file the first flow does not list, so it keeps its function's name; a code id the trace has no flow for names none.
  expect(named([{ ...RUN_FLOW, steps: [step("Elsewhere.", `${TYPES_TS}#1`)] }, OTHER_FLOW])).toEqual([["run", undefined], ["Other loads it too", "other"]]);
  expect(named([{ ...OTHER_FLOW, id: "code-3" }])).toEqual([["run", undefined], ["other", undefined]]);
});

it("u7689b_a_read_adds_flows_the_code_cannot_see_replaces_not_traced_and_ends_with_unplaced", async () => {
  const answer: Answering = { state: { state: "notRead" } };

  await flowsRead(answer);
  await waitFor(() => expect(moduleKeys()).toEqual([flowKey(RUN), flowKey(OTHER), "m:~unplaced", "m:~untraced"]));
  await openOverview();
  press("r");
  await waitFor(() => expect(states().textContent).toContain(copy.readingBack));
  answer.state = result("read");
  await waitFor(() => expect(moduleKeys()).toEqual(NAMES), { timeout: 3000 });

  // The added flow is marked, holds its file whole, and Not traced is gone; Unplaced holds the files of the ids the readback left over, in path order.
  expect(said("~read:added-1")).toContain(copy.fromReadback);
  take(moduleRow("~read:added-1"));
  await showing(LIB_RS);
  expect(openPaths()).toEqual([LIB_RS]);
  take(moduleRow("~unplaced"));
  await showing(TYPES_TS);
  expect(openPaths()).toEqual([TYPES_TS, README]);
});

it("u7689b_rust_files_with_no_trace_are_placed_by_the_readback", async () => {
  await flowsRead({ state: result("read") });
  await waitFor(() => expect(moduleKeys()).toEqual(NAMES));

  // Rust is untraced, yet its file sits in the added flow; a Trace later adds its own flow and leaves the readback read.
  fireEvent.click(await screen.findByRole("button", { name: copy.trace }));
  await waitFor(() => expect(moduleKeys()).toContain(flowKey(SHOUT)));
  expect(moduleKeys()).toContain("m:~read:added-1");
  expect(said("~read:added-1")).not.toContain(copy.changedSinceReadback);
});

it("u7689c_not_traced_offers_the_readback_on_tree_and_branch_and_none_on_changes", async () => {
  const answer: Answering = { state: { state: "notRead" } };
  const { app } = await flowsRead(answer, "changes");

  // U7955a: Changes reads as Tree does, so Not traced offers the readback there too.
  await waitFor(() => expect(moduleKeys()).toEqual(["m:~untraced"]));
  await waitFor(() => expect(said("~untraced")).toContain(copy.readToSee));

  fireEvent.click(screen.getByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(said("~untraced")).toContain(copy.readToSee));

  // The pane holds the line over an icon button; it starts the run once, and the words leave.
  take(moduleRow("~untraced"));
  await waitFor(() => expect(within(document.body).getAllByText(copy.readToSee).length).toBe(1));
  fireEvent.click(within(document.body).getByRole("button", { name: copy.readBack }));
  await waitFor(() => expect(said("~untraced")).not.toContain(copy.readToSee));
  expect(calls(app, "agent.readbackStart")).toBe(1);
});

it("u7689d_reading_and_failed_leave_the_code_flows_as_they_were_and_retry_reads_again", async () => {
  const answer: Answering = { state: { state: "notRead" } };
  const { app } = await flowsRead(answer);

  await waitFor(() => expect(moduleKeys()).toEqual([flowKey(RUN), flowKey(OTHER), "m:~unplaced", "m:~untraced"]));
  await openOverview();
  press("r");
  await waitFor(() => expect(states().textContent).toContain(copy.readingBack));
  expect(moduleKeys()).toEqual([flowKey(RUN), flowKey(OTHER), "m:~unplaced", "m:~untraced"]);

  // The Daemon refuses an answer that moves a code flow's hunk, and says why: the flows stay as the code found them.
  const cause = "flow code-1 moves or reorders the hunks the code found for it";

  answer.state = { state: "failed", kind: "badAnswer", cause };
  await waitFor(() => expect(states().querySelector(".flow-cause")?.textContent).toBeTruthy(), { timeout: 3000 });
  expect(states().textContent).toContain(copy.readbackFailed);
  expect(moduleKeys()).toEqual([flowKey(RUN), flowKey(OTHER), "m:~unplaced", "m:~untraced"]);
  expect(said(flowName(RUN.key))).not.toContain(RUN_FLOW.name);

  fireEvent.click(within(states()).getByRole("button", { name: copy.retry }));
  await waitFor(() => expect(calls(app, "agent.readbackStart")).toBe(2));
});

it("u7689d_a_stale_readback_dims_the_names_and_explanations_and_leaves_the_code_flows", async () => {
  await flowsRead({ state: result("stale") });
  await waitFor(() => expect(moduleKeys()).toEqual(NAMES));

  // The names and the added flow stay, dimmed and said so; the code's flows are not dimmed as a stale trace is.
  expect(moduleRow(flowName(RUN.key)).querySelector('.changes-row-name[data-stale="true"]')?.textContent).toBe(RUN_FLOW.name);
  expect(said(flowName(RUN.key))).toContain(copy.changedSinceReadback);
  expect(said("~read:added-1")).toContain(copy.changedSinceReadback);
  expect(moduleRow(flowName(RUN.key)).getAttribute("data-dim")).toBeNull();
  expect(said(flowName(RUN.key))).not.toContain(copy.changedSinceTraced);

  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(slot()?.querySelector('.flow-account[data-stale="true"]')).not.toBeNull());
  await tick();
});

it("u7689e_marking_a_flow_viewed_opens_the_next_unviewed_one_an_added_flow_included_and_a_shared_file_reads_viewed_in_both", async () => {
  await flowsRead({ state: result("read") });
  await waitFor(() => expect(moduleKeys()).toEqual(NAMES));

  // The added flow and Unplaced count in M.
  expect(screen.getByText(copy.viewedProgress(0, 4))).toBeTruthy();

  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(labels()).toEqual(["run", "load"]));
  press("v");

  // run and other list the same two files, so both read viewed; the added flow, next in the list, opens.
  await waitFor(() => { showViewedRows(); expect(said(flowName(RUN.key))).toContain(copy.viewed); });
  expect(said(flowName(OTHER.key))).toContain(copy.viewed);
  await showing(LIB_RS);
  expect(screen.getByText(copy.viewedProgress(2, 4))).toBeTruthy();
});
