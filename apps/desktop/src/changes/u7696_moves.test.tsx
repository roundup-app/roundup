import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeEach, expect, it, vi } from "vitest";
import type { CallPaths } from "@contracts/agent/CallPaths";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { copy } from "./copy";
import { answers, ALIAS, flowComparison, FLOW_FILES, LOAD, OTHER, RUN, TYPESCRIPT } from "./flowFixture";
import { standInReader, reads } from "./moveHarness";
import type { Moved } from "./moves";
import { take } from "./noteHarness";
import { chooseLens, comparison, drawnIn, landed, moduleRow, region, setUpView, text, there } from "./viewHarness";

setUpView();

// U7696: moved and renamed code marked in the Logic lens, over the U7695 fixture and a stand-in for the move Worker.

const RUN_PATH = "apps/a/src/run.ts";

const LOAD_PATH = "apps/a/src/load.ts";

const MARKS = new Map<string, Moved[]>([
  [RUN_PATH, [{ kind: "moved", lines: [{ start: 19, end: 21 }], from: { path: RUN_PATH, start: 2, end: 4 } }]],
  [LOAD_PATH, [{ kind: "renamed", lines: [{ start: 1, end: 1 }, { start: 3, end: 3 }], was: "MAX_RETRIES", now: "MAX_ATTEMPTS" }]],
]);

/** Every section the scroll observes is reported at once, so each file of an item is drawn. */
class Eager {
  constructor(private readonly report: (entries: { isIntersecting: boolean; target: Element }[]) => void) {}

  observe(target: Element) { queueMicrotask(() => this.report([{ isIntersecting: true, target }])); }

  unobserve() {}

  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", Eager);
  standInReader();
  reads.answer = ({ path }) => MARKS.get(path) ?? [];
});

type Mounted = Awaited<ReturnType<typeof landed>>;

/** The view over the Tree target, in Logic, with `prepare` run on the fake App first. */
const logicOpen = async (prepare: (app: Mounted["app"]) => void = () => undefined, read: (path: string) => FileComparison = flowComparison) => {
  const mounted = await landed(() => ({ files: FLOW_FILES }), read);

  mounted.app.handlers["agent.callPaths"] = answers();
  prepare(mounted.app);
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.logic);
  take(moduleRow("apps/a"));

  return mounted;
};

const stamped = (path: string, mark = "moved") => drawnIn(path).flatMap(each => [...each.shadowRoot?.querySelectorAll(`[data-line][data-${mark}]`) ?? []]).map(line => Number(line.getAttribute("data-line")));

const drawnLines = (path: string) => drawnIn(path).flatMap(each => [...each.shadowRoot?.querySelectorAll("[data-line]") ?? []]).map(line => Number(line.getAttribute("data-line")));

const said = (name: string) => moduleRow(name).getAttribute("aria-label") ?? "";

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

it("u7696a_moved_and_renamed_code_is_marked_at_its_lines_and_names_its_other_place", async () => {
  await logicOpen();

  await waitFor(() => expect(stamped(RUN_PATH)).toEqual([19, 20, 21]));
  await waitFor(() => expect(stamped(LOAD_PATH)).toEqual([1, 3]));
  await screen.findByText(copy.movedFrom(copy.repeatPlace(RUN_PATH, 2, 4)));
  await screen.findByText(copy.renamedTo("MAX_RETRIES", "MAX_ATTEMPTS"));

  // A mark folds nothing: the lines around the change are all still drawn.
  expect(drawnLines(RUN_PATH)).toEqual(expect.arrayContaining([17, 18, 19, 20, 21, 22, 23]));
});

it("u7696b_the_row_counts_its_moves_and_none_says_nothing", async () => {
  await logicOpen();
  await waitFor(() => expect(said("apps/a")).toContain(copy.movedCount(2)));

  // A module whose files hold none says nothing, and the other lenses count none.
  take(moduleRow("crates/b"));
  await waitFor(() => expect(drawnIn("crates/b/src/lib.rs").length).toBeGreaterThan(0));
  expect(said("crates/b")).not.toMatch(/moved/);
  await chooseLens(copy.lenses.flows);
  expect(region().textContent).not.toMatch(/moved/i);
  expect(stamped(RUN_PATH)).toEqual([]);
});

it("u7696c_a_failed_read_says_its_cause_and_retry_asks_again_and_a_slow_one_says_so", async () => {
  reads.answer = () => { throw new Error("grammar rust: 404"); };

  await logicOpen();

  const states = within(await screen.findByRole("region", { name: copy.movedCode }));

  states.getByText(copy.movesFailed);
  states.getByText("grammar rust: 404");
  reads.answer = ({ path }) => MARKS.get(path) ?? [];
  fireEvent.click(states.getByRole("button", { name: copy.retry }));
  await waitFor(() => expect(stamped(RUN_PATH)).toEqual([19, 20, 21]));
  expect(screen.queryByRole("region", { name: copy.movedCode })).toBeNull();
});

it("u7696c_a_slow_read_says_so_after_a_pause_and_none_before", async () => {
  let release: (moved: Moved[]) => void = () => undefined;

  reads.answer = () => new Promise<Moved[]>(resolve => { release = resolve; });
  await logicOpen();
  expect(screen.queryByText(copy.checkingMoves)).toBeNull();
  await tick(200);
  await screen.findByText(copy.checkingMoves);
  release([]);
  await waitFor(() => expect(screen.queryByText(copy.checkingMoves)).toBeNull());
});

it("u7696e_a_repeat_whose_lines_moved_is_not_also_a_repeat", async () => {
  await logicOpen(app => {
    app.handlers["agent.repeatScan"] = () => ({ hits: [{ path: RUN_PATH, start: 19, end: 21, other: { path: "pkg/a.ts", start: 1, end: 3 } }, { path: LOAD_PATH, start: 4, end: 5, other: { path: "pkg/b.ts", start: 1, end: 2 } }], complete: true });
  });

  await waitFor(() => expect(stamped(LOAD_PATH, "repeat")).toEqual([4, 5]));
  await waitFor(() => expect(said("apps/a")).toContain(copy.repeatsCount(1)));
  expect(stamped(RUN_PATH, "repeat")).toEqual([]);
  expect(screen.queryByRole("button", { name: copy.repeatsAt(copy.repeatPlace("pkg/a.ts", 1, 3)) })).toBeNull();
});

const rows = () => within(there(screen.queryByRole("list", { name: copy.functionsAndTypes }))).getAllByRole("listitem").map(row => row.textContent);

it("u7696f_the_list_labels_a_moved_function_and_a_renamed_one", async () => {
  const moved: CallPaths = { ...TYPESCRIPT, symbols: [{ ...RUN, new: { start: 19, end: 21 } }, OTHER, LOAD, ALIAS] };

  await logicOpen(app => { app.handlers["agent.callPaths"] = params => params.language === "typescript" ? moved : answers()(params); });
  fireEvent.click(await screen.findByRole("button", { name: copy.functionsAndTypes }));

  await waitFor(() => expect(rows()).toEqual(expect.arrayContaining(["run function moved", "load function renamed", "other function", "Alias type"])));
});

const symbol = (path: string, name: string, over: Partial<ChangedSymbol>): ChangedSymbol => ({ key: `${path}##${name}#function`, name, kind: "function", path, old: null, new: null, status: "changed", callable: true, ...over });

const lined = (body: string[]) => (change: (line: number) => string) => Array.from({ length: 25 }, (_, at) => at >= 9 && at <= 12 ? body[at - 9] : change(at + 1)).join("\n") + "\n";

it("u7696g_code_moved_to_another_file_is_marked_in_the_file_that_gained_it", async () => {
  const body = ["function legacy() {", "  const a = 1;", "  return a;", "}"];

  const reads = (path: string): FileComparison => path === RUN_PATH ? comparison(path, { old: text("old", lined(body)(line => `line ${line}`)), new: text("new", Array.from({ length: 25 }, (_, at) => `line ${at + 1}`).join("\n") + "\n") })
    : path === LOAD_PATH ? comparison(path, { old: text("old", Array.from({ length: 25 }, (_, at) => `line ${at + 1}`).join("\n") + "\n"), new: text("new", lined(body.map((line, at) => at === 0 || at === 3 ? line : `    ${line}`))(line => `line ${line}`)) })
      : flowComparison(path);

  const moved: CallPaths = { ...TYPESCRIPT, symbols: [...TYPESCRIPT.symbols, symbol(RUN_PATH, "legacy", { old: { start: 10, end: 13 }, status: "removed" }), symbol(LOAD_PATH, "legacy", { new: { start: 10, end: 13 }, status: "added" })] };

  await logicOpen(app => { app.handlers["agent.callPaths"] = params => params.language === "typescript" ? moved : answers()(params); }, reads);

  await waitFor(() => expect(stamped(LOAD_PATH)).toEqual([10, 11, 12, 13]));
  await screen.findByText(copy.movedFrom(copy.repeatPlace(RUN_PATH, 10, 13)));
});
