import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import type { Account } from "@contracts/agent/Account";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { Readback } from "@contracts/agent/Readback";
import { copy } from "./copy";
import { answers, FLOW_FILES, flowComparison, RUN, TYPESCRIPT } from "./flowFixture";
import { flowName, groupFlows } from "./flows";
import { groupLens } from "./lens";
import { fileRanks, withRisks } from "./rank";
import { take } from "./noteHarness";
import { at, chooseLens, counted, landed, marks, moduleRow, multi, openPaths, pane, press, region, setUpView, showing, slot, there } from "./viewHarness";

setUpView();

// U7697: the readback's ranks order an item's files and its risks mark the rows, over the lens fixture and a fake Daemon that answers `agent.readback`.

const FILES: ChangedFile[] = ["crates/a/src/a.rs", "crates/a/src/x.rs", "crates/a/tests/a.rs", "crates/a/tests/x.rs", "crates/b/src/y.rs", "crates/c/src/z.rs"].map(path => counted(path, 3, 1));

const ACCOUNT: Account = {
  overview: "o",
  diagram: "",
  flows: [],
  modules: [],
  unplaced: [],
  ranks: [
    { hunk: "crates/a/src/a.rs#1", rank: "glue" },
    { hunk: "crates/a/src/x.rs#1", rank: "glue" },
    { hunk: "crates/a/src/x.rs#2", rank: "core" },
    { hunk: "crates/a/tests/a.rs#1", rank: "glue" },
    { hunk: "crates/a/tests/x.rs#1", rank: "forced" },
  ],
  risks: [
    { target: "module", id: "crates/a", level: "high", reason: "Changes what the rail counts as owned." },
    { target: "module", id: "crates/b", level: "medium", reason: "Touches the parser." },
    { target: "module", id: "crates/c", level: "low", reason: "A rename." },
    { target: "flow", id: "code-1", level: "high", reason: "Run reads load first." },
    { target: "flow", id: "added-1", level: "low", reason: "Small." },
  ],
  explanations: [],
  gaps: [],
};

const paths = (files: readonly ChangedFile[]) => files.map(file => file.path);

it("u7697a_a_readback_orders_an_items_files_core_then_forced_then_glue_and_tests_follow_logic", () => {
  const ranks = fileRanks(ACCOUNT);
  const module = (lens: "modules" | "logic" | "tests") => paths(groupLens(FILES, lens, ranks).modules.find(each => each.name === "crates/a")?.files ?? []);

  expect(module("modules")).toEqual(["crates/a/src/x.rs", "crates/a/src/a.rs", "crates/a/tests/x.rs", "crates/a/tests/a.rs"]);
  expect(module("logic")).toEqual(["crates/a/src/x.rs", "crates/a/src/a.rs"]);
  expect(module("tests")).toEqual(["crates/a/tests/x.rs", "crates/a/tests/a.rs"]);
});

it("u7697a_a_flow_keeps_call_order_whatever_the_ranks", () => {
  const ranks = FLOW_FILES.flatMap((file, at) => [{ hunk: `${file.path}#1`, rank: (["glue", "core", "forced"] as const)[at % 3] ?? "core" }]);
  const order = (read?: { account: Account; stale: boolean }) => groupFlows(FLOW_FILES, [TYPESCRIPT], read).modules.filter(item => item.flow).map(item => item.sections?.map(section => section.id));

  expect(order({ account: { ...ACCOUNT, ranks }, stale: false })).toEqual(order());
});

it("u7697b_without_a_readback_the_order_is_path_order_and_no_mark_shows", async () => {
  expect(paths(groupLens(FILES, "modules").modules[0]?.files ?? [])).toEqual(["crates/a/src/a.rs", "crates/a/src/x.rs", "crates/a/tests/a.rs", "crates/a/tests/x.rs"]);
  expect(withRisks(groupLens(FILES, "modules"), undefined, false).modules.every(each => each.risk === undefined)).toBe(true);
  // A result with no rank for a path leaves it in path order.
  expect(paths(groupLens(FILES, "logic", fileRanks({ ...ACCOUNT, ranks: [] })).modules[0]?.files ?? [])).toEqual(["crates/a/src/a.rs", "crates/a/src/x.rs"]);

  await landed(() => ({ files: FILES }));
  expect(region().querySelector(".risk-mark")).toBeNull();
});

const opened = async (state: Readback) => {
  const mounted = await landed(() => ({ files: FILES }), path => multi(path));

  mounted.app.handlers["agent.readback"] = () => state;
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(region().querySelector(".risk-mark")).not.toBeNull());

  return mounted;
};

const marksOf = (row: Element) => [...row.querySelectorAll(".risk-mark")].map(mark => mark.getAttribute("aria-label"));

it("u7697c_high_and_medium_draw_one_mark_and_low_draws_none", async () => {
  await opened({ state: "read", ...ACCOUNT });
  expect(marksOf(moduleRow("crates/a"))).toEqual([copy.riskMark.high]);
  expect(marksOf(moduleRow("crates/b"))).toEqual([copy.riskMark.medium]);
  expect(marksOf(moduleRow("crates/c"))).toEqual([]);
  // The reason is no words of the row: no tooltip is open until the mark is hovered or focused.
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("u7697d_hover_and_focus_show_the_reason_credited_to_the_readback", async () => {
  await opened({ state: "read", ...ACCOUNT });
  const mark = within(moduleRow("crates/a")).getByRole("img", { name: copy.riskMark.high });

  vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
  fireEvent.pointerEnter(mark, { pointerType: "mouse", clientX: 10, clientY: 10 });
  const tip = await screen.findByRole("tooltip");

  expect(tip.textContent).toContain(ACCOUNT.risks[0]?.reason);
  expect(tip.textContent).toContain(copy.readbackCredit);
  expect(tip.textContent).not.toContain(copy.changedSinceReadback);
  fireEvent.pointerLeave(mark, { pointerType: "mouse", clientX: 900, clientY: 900 });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("u7697e_a_stale_readback_dims_the_marks_and_keeps_the_order", async () => {
  await opened({ state: "stale", ...ACCOUNT });
  const mark = within(moduleRow("crates/a")).getByRole("img", { name: copy.riskMark.high });

  expect(mark.dataset.stale).toBe("true");
  vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
  fireEvent.pointerEnter(mark, { pointerType: "mouse", clientX: 10, clientY: 10 });
  expect((await screen.findByRole("tooltip")).textContent).toContain(copy.changedSinceReadback);
  fireEvent.pointerLeave(mark, { pointerType: "mouse", clientX: 900, clientY: 900 });

  // The order stays as ranked.
  take(moduleRow("crates/a"));
  await showing("crates/a/src/x.rs");
  expect(openPaths()).toEqual(["crates/a/src/x.rs", "crates/a/src/a.rs", "crates/a/tests/x.rs", "crates/a/tests/a.rs"]);
});

it("u7697a_keys_and_viewed_follow_the_ranked_order", async () => {
  await opened({ state: "read", ...ACCOUNT });
  take(moduleRow("crates/a"));
  await showing("crates/a/src/x.rs");

  // The scroll holds the ranked order, and ] at the last change of the first file crosses into the next ranked file, not the next path.
  expect(openPaths()).toEqual(["crates/a/src/x.rs", "crates/a/src/a.rs", "crates/a/tests/x.rs", "crates/a/tests/a.rs"]);

  for (let change = 0; change < 3; change += 1) press("]");
  await marks(at("old", 45), "crates/a/src/x.rs");
  press("]");
  await marks(at("old", 3), "crates/a/src/a.rs");

  // Viewed marks the module as on path order.
  fireEvent.click(within(there(slot())).getByRole("button", { name: copy.viewed }));
  await waitFor(() => expect(moduleRow("crates/a").getAttribute("aria-label")).toContain(copy.viewed));
});

const FLOWS: Account = {
  ...ACCOUNT,
  flows: [
    { id: "code-1", name: "Run loads the data", source: "code", steps: [{ note: "Load reads the data.", hunks: ["apps/a/src/load.ts#1"] }, { note: "Run asks load for it.", hunks: ["apps/a/src/run.ts#1"] }] },
    { id: "added-1", name: "Shout is checked", source: "readback", steps: [{ note: "Shout upcases.", hunks: ["crates/b/src/lib.rs#1"] }] },
  ],
  ranks: [],
  risks: [
    { target: "module", id: "apps/a", level: "high", reason: "Changes the loader." },
    { target: "module", id: "crates/b", level: "low", reason: "A rename." },
    { target: "flow", id: "code-1", level: "high", reason: "Run reads load first." },
    { target: "flow", id: "added-1", level: "medium", reason: "Small." },
  ],
};

const entryOf = (name: string) => there(pane().querySelector(`[data-entry="m:${name}"]`));

it("u7697c_a_marks_sit_on_the_row_and_the_overview_line_of_its_module_or_flow", async () => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), flowComparison);

  mounted.app.handlers["agent.callPaths"] = answers();
  mounted.app.handlers["agent.readback"] = () => ({ state: "read", ...FLOWS });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  // A module: its row, its Overview line and the item's header; a low one shows none; the count and the Viewed mark stay as they were.
  await waitFor(() => expect(marksOf(moduleRow("apps/a"))).toEqual([copy.riskMark.high]));
  expect(marksOf(entryOf("apps/a"))).toEqual([copy.riskMark.high]);
  expect(marksOf(moduleRow("crates/b"))).toEqual([]);
  expect(marksOf(entryOf("crates/b"))).toEqual([]);
  expect(entryOf("apps/a").querySelector(".changes-row-files")?.textContent).toContain(String(3));
  expect(moduleRow("apps/a").getAttribute("aria-label")).not.toContain(copy.viewed);
  take(moduleRow("apps/a"));
  await waitFor(() => expect(marksOf(there(slot()))).toEqual([copy.riskMark.high]));

  // A flow and an added flow: row, Overview line and header.
  await chooseLens(copy.lenses.flows);
  await waitFor(() => expect(marksOf(moduleRow(flowName(RUN.key)))).toEqual([copy.riskMark.high]));
  expect(marksOf(moduleRow("~read:added-1"))).toEqual([copy.riskMark.medium]);
  take(moduleRow(flowName(RUN.key)));
  await waitFor(() => expect(marksOf(there(slot()))).toEqual([copy.riskMark.high]));
  take(moduleRow("~read:added-1"));
  await waitFor(() => expect(marksOf(there(slot()))).toEqual([copy.riskMark.medium]));
  expect(mounted.app.calls.filter(call => call.method === "agent.readbackStart")).toEqual([]);
});
