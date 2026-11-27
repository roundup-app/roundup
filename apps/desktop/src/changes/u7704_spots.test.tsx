import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Kind } from "@contracts/Kind";
import type { ScanSpots } from "@contracts/agent/ScanSpots";
import type { Spot } from "@contracts/agent/Spot";
import type { Spots } from "@contracts/agent/Spots";
import { RpcError } from "../app/seam";
import { mountRail, rowOf } from "../rail/railFixture";
import { agent, event } from "../testing/nodes";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { COMPARISON, openChanges, openFile, take, treeRow } from "./noteHarness";
import { calls, comparison, counted, drawnIn, fresh, moduleRow, setUpView, text } from "./viewHarness";

setUpView();

// U7704: the spots tools post, marked in the Changes view's gutter and counted in the item's row, over a fake Daemon that answers `agent.spots`.

const NEW = "pkg/src/new.ts";

const FILES = [NEW, "mod/b.ts"].map(path => counted(path, 17, 17));

const lines = (change: (line: number) => string) => Array.from({ length: 40 }, (_, index) => change(index + 1)).join("\n") + "\n";

const read = (path: string): FileComparison => comparison(path, { old: text("old", lines(line => `line ${line}`)), new: text("new", lines(line => line >= 6 && line <= 22 ? `line ${line} new` : `line ${line}`)) });

type Told = Spot & { source: { kind: "tool"; name: string }; message: string };

const tool = (name: string, start: number, end: number, message: string, stale = false, path = NEW): Told => ({ source: { kind: "tool", name }, path, start, end, message, stale });

const LINT = tool("oxlint", 8, 9, "unused variable");

const OUTDATED = tool("tests", 12, 13, "fails here", true);

const REPEAT: Spot = { source: { kind: "repeats" }, path: NEW, start: 16, end: 18, other: { path: "pkg/src/owned.ts", start: 1, end: 3 }, stale: false };

const tick = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(yes => { resolve = yes; });

  return { promise, resolve };
};

/** The view over the Tree target, whose `agent.spots` `answer` answers by the number of the ask and whose repeat scan holds `repeats`. */
const treeOpen = async (answer: (n: number) => Spots | Promise<Spots>, repeats: readonly Spot[] = []) => {
  const mounted = await mountControl(() => ({ files: FILES }), fresh());
  let asked = 0;

  mounted.app.handlers["agent.compareFile"] = ({ path }) => read(path);
  mounted.app.handlers["agent.repeatScan"] = () => ({ spots: [...repeats], complete: true } satisfies ScanSpots);
  mounted.app.handlers["agent.spots"] = () => answer(++asked);
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  return mounted;
};

/** The new-side lines of `path` that carry the spot stamp. */
const stamped = (path: string) => drawnIn(path).flatMap(each => [...each.shadowRoot?.querySelectorAll("[data-line][data-spot]") ?? []]).map(line => Number(line.getAttribute("data-line")));

const said = (name: string) => moduleRow(name).getAttribute("aria-label") ?? "";

const status = (kind: Kind) => ({ id: "a", attempt: "1", status_revision: "2", status: { kind, label: kind, since: 0, finished: "1" } });

it("u7704a_a_tools_spot_is_marked_at_its_lines_and_names_its_source", async () => {
  await treeOpen(() => ({ spots: [LINT, OUTDATED] }));
  await openFile(NEW);
  await waitFor(() => expect(stamped(NEW)).toEqual([8, 9, 12, 13]));

  const marks = [...document.querySelectorAll(".spot-mark")].map(mark => mark.textContent ?? "");

  expect(marks).toHaveLength(2);
  expect(marks[0]).toContain(LINT.source.name);
  expect(marks[0]).toContain(LINT.message);
  expect(marks[0]).not.toContain(copy.outdated);
  expect(marks[1]).toContain(OUTDATED.source.name);
  expect(marks[1]).toContain(OUTDATED.message);
  expect(marks[1]).toContain(copy.outdated);
  expect(document.querySelectorAll(".spot-mark button")).toHaveLength(0);
});

it("u7704b_the_row_counts_each_source_and_none_says_nothing", async () => {
  await treeOpen(() => ({ spots: [LINT, OUTDATED, tool("oxlint", 20, 21, "second", false)] }), [REPEAT]);

  await waitFor(() => expect(said("pkg")).toContain(copy.repeatsCount(1)));
  await waitFor(() => expect(said("pkg")).toContain(copy.fromSource(2, "oxlint")));
  expect(said("pkg")).toContain(copy.fromSource(1, "tests"));
  expect(said("mod")).not.toMatch(/\d+ from /);
  expect(moduleRow("mod").textContent).not.toMatch(/\d+ from /);
});

it("u7704c_changes_reads_send_the_open_group_and_branch_asks_none", async () => {
  const worktree = { worktree: { path: "/w/b", branch: "own/b", base: "main", adopted: false } };
  const file = { path: "own.ts", status: "modified" as const, line: 1, counts: { added: 1, removed: 0 }, blob: null };

  const { app } = await mountRail([agent("a", "idle", "ready"), agent("b", "idle", "ready", worktree)], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p", checkout: "/p", branch: "main", base: "main", files: [file] }, { repo: "/q", checkout: "/q", branch: "own/x", base: "main", files: [{ ...file, path: "other.ts" }] }] });
    app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  });

  const asked = () => app.calls.filter(call => call.method === "agent.spots").map(call => call.params);

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "2 changed files" }));
  take(await treeRow("own.ts"));
  await waitFor(() => expect(asked().at(-1)).toEqual({ id: "a", group: { repo: "/p", branch: "main" } }));

  const [, second] = within(await screen.findByRole("list", { name: "Repositories and branches" })).getAllByRole("button");

  if (!second) throw new Error("The group list has no second group");

  fireEvent.click(second);
  await waitFor(() => expect(asked().at(-1)).toEqual({ id: "a", group: { repo: "/q", branch: "own/x" } }));

  // The Branch target ends on HEAD's commit, not on the working copy the spots name: it asks none.
  fireEvent.click(rowOf("b"));
  fireEvent.click(await within(rowOf("b")).findByRole("button", { name: "2 changed files" }));
  await screen.findByText("b", { selector: ".changes-name" });
  await waitFor(() => expect(asked().at(-1)).toEqual({ id: "b", group: { repo: "/p", branch: "main" } }));
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetBranch }));

  const before = asked().length;

  await tick(200);
  expect(asked()).toHaveLength(before);
});

it("u7704d_a_turn_end_reads_again_and_keeps_the_marks_meanwhile", async () => {
  const second = deferred<Spots>();
  let late = Number.POSITIVE_INFINITY;
  const { app } = await treeOpen(n => n === late ? second.promise : { spots: [LINT] });

  await openFile(NEW);
  await waitFor(() => expect(stamped(NEW)).toEqual([8, 9]));

  const before = calls(app, "agent.spots");

  late = before + 1;
  // A turn that wrote nothing still reads again; the marks stay while the answer is pending.
  app.emit(event({ name: "agent.status", data: status("done") }));
  await waitFor(() => expect(calls(app, "agent.spots")).toBe(before + 1));
  expect(stamped(NEW)).toEqual([8, 9]);
  second.resolve({ spots: [LINT, OUTDATED] });
  await waitFor(() => expect(stamped(NEW)).toEqual([8, 9, 12, 13]));
});

it("u7704e_a_spot_no_line_shows_is_listed_under_other_spots", async () => {
  const past = tool("oxlint", 41, 60, "past the end");
  const gone = tool("oxlint", 1, 2, "in a file the listing lacks", false, "pkg/src/gone.ts");

  await treeOpen(() => ({ spots: [past, gone] }));

  // The Overview holds the spot of the file the listing lacks, and not the other.
  const overview = within(await screen.findByRole("region", { name: copy.overview }));
  const unlisted = await overview.findByRole("list", { name: copy.otherSpots });

  expect(unlisted.textContent).toContain(gone.message);
  expect(unlisted.textContent).not.toContain(past.message);

  // The file's diff ends with the spot that ends past its last line.
  await openFile(NEW);
  const group = await screen.findByRole("list", { name: copy.otherSpots });

  expect(group.textContent).toContain(past.source.name);
  expect(group.textContent).toContain(copy.repeatPlace(NEW, 41, 60));
  expect(group.textContent).toContain(past.message);
  expect(stamped(NEW)).toEqual([]);
});

it("u7704f_a_failed_read_says_its_cause_and_retry_asks_again", async () => {
  let failing = true;

  const { app } = await treeOpen(() => {
    if (failing) throw new RpcError(-32603, "failed: the spots could not be read");

    return { spots: [LINT] };
  });

  await screen.findByText(copy.spotsFailed);
  await screen.findByText("failed: the spots could not be read", { exact: false });
  await tick();
  failing = false;

  const before = calls(app, "agent.spots");

  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await waitFor(() => expect(screen.queryByText(copy.spotsFailed)).toBeNull());
  expect(calls(app, "agent.spots")).toBe(before + 1);
});
