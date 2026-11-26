import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { Account } from "@contracts/agent/Account";
import type { Explanation } from "@contracts/agent/Explanation";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Gap } from "@contracts/agent/Gap";
import type { LineExplanation } from "@contracts/agent/LineExplanation";
import type { Readback } from "@contracts/agent/Readback";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges, saveNote } from "./noteHarness";
import { calls, comparison, counted, drawn, drawnIn, fresh, moduleRow, press, section, setUpView, showing, text } from "./viewHarness";

setUpView();

// U7699: the explanations of a readback under their lines, over a fake Daemon that answers `agent.readback` and `agent.explain`.

const NEW = "pkg/src/new.ts";

const FILES = [NEW, "mod/b.ts"].map(path => counted(path, 17, 0));

const original = (line: number) => (line >= 6 && line <= 22 ? `added ${line}` : `line ${line}`);

/** The new text: lines 6 to 22 are added; the old text holds the other lines. */
const body = (change: (line: number) => string) => Array.from({ length: 40 }, (_, index) => change(index + 1)).join("\n") + "\n";

const before = Array.from({ length: 40 }, (_, index) => index + 1).filter(line => line < 6 || line > 22).map(line => `line ${line}`).join("\n") + "\n";

const LOADER: LineExplanation = { path: NEW, start: 8, end: 9, source: "added 8\nadded 9", text: "Adds the loader." };

const WIRING: LineExplanation = { path: NEW, start: 14, end: 14, source: "added 14", text: "Wires it into run." };

const account = (over: Partial<Account> = {}): Account => ({ overview: "Adds a loader.", diagram: "", flows: [], modules: [], unplaced: [], ranks: [], risks: [], explanations: [LOADER, WIRING], stops: [], gaps: [], ...over });

type Daemon = { blob: string; changed: (line: number) => string; readback: Readback; explain: (params: { start: number }) => Explanation };

const daemon = (over: Partial<Daemon> = {}): Daemon => ({ blob: "one", changed: original, readback: { state: "read", ...account() }, explain: () => ({ state: "explained", form: "words", text: "Second." }), ...over });

const read = (now: Daemon) => (path: string): FileComparison => comparison(path, { old: text("old", before), new: text(`new-${now.blob}`, body(now.changed)) });

/** The view over the Tree target with the module of `NEW` open and drawn. */
const open = async (now: Daemon) => {
  const mounted = await mountControl(() => ({ files: FILES.map(file => ({ ...file, blob: now.blob })) }), fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => read(now)(path);
  mounted.app.handlers["agent.readback"] = () => now.readback;
  mounted.app.handlers["agent.explain"] = params => now.explain(params);
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  fireEvent.click(await waitFor(() => moduleRow("pkg")));
  await showing(NEW);
  await drawn(NEW);

  return mounted;
};

/** U7693c: the Tree list reads again when the target changes; the file is read again once its blob id differs. */
const relist = async (app: { calls: { method: string }[] }) => {
  const reads = calls(app, "agent.compareFile");

  fireEvent.click(screen.getByRole("radio", { name: copy.targetBranch }));
  await waitFor(() => expect(screen.getByRole("radio", { name: copy.targetBranch }).getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(screen.getByRole("radio", { name: copy.targetTree }));
  fireEvent.click(await waitFor(() => moduleRow("pkg")));
  await showing(NEW);
  await drawn(NEW);
  await waitFor(() => expect(calls(app, "agent.compareFile")).toBeGreaterThan(reads));
};

const regions = () => screen.getAllByRole("region", { name: copy.explanation });

const stale = () => regions().map(each => each.getAttribute("data-stale"));

const asked = (app: { calls: { method: string; params?: unknown }[] }) => app.calls.filter(call => call.method === "agent.explain").map(call => call.params);

const tick = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));

it("u7699a_a_read_draws_its_explanations_under_their_lines_and_the_view_starts_none", async () => {
  const { app } = await open(daemon());

  expect(await screen.findByText(LOADER.text)).toBeTruthy();
  expect(screen.getByText(WIRING.text)).toBeTruthy();
  expect(screen.getAllByText(copy.readbackCredit).length).toBe(2);
  expect(regions().every(each => section(NEW)?.contains(each))).toBe(true);
  expect(stale()).toEqual(["false", "false"]);

  // Opening the view, a turn that wrote and a wait start nothing.
  await tick();
  expect(calls(app, "agent.readbackStart")).toBe(0);
  expect(calls(app, "agent.explain")).toBe(0);
});

it("u7699b_a_write_over_the_lines_greys_an_explanation_and_ask_again_asks_once", async () => {
  const now = daemon();
  const { app } = await open(now);

  await screen.findByText(LOADER.text);

  // A write to other lines of the file leaves both as they were.
  now.blob = "two";
  now.changed = line => (line === 20 ? "edited 20" : original(line));
  await relist(app);
  expect(stale()).toEqual(["false", "false"]);

  // A write over the first one's lines greys it alone and offers Ask again.
  now.blob = "three";
  now.changed = line => (line === 9 || line === 20 ? `edited ${line}` : original(line));
  await relist(app);
  await waitFor(() => expect(stale()).toEqual(["true", "false"]));
  expect(screen.getByText(copy.changedSinceReadback, { exact: false })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: copy.askAgain }).length).toBe(1);

  // Its click asks once for that range, and the answer replaces it.
  fireEvent.click(screen.getByRole("button", { name: copy.askAgain }));
  await screen.findByText("Second.");
  expect(asked(app)).toEqual([{ id: "a", to: "tree", path: NEW, side: "new", start: 8, end: 9, form: "words" }]);
  expect(screen.queryByText(LOADER.text)).toBeNull();
  expect(screen.getByText(WIRING.text)).toBeTruthy();
});

it("u7699c_a_stale_result_keeps_its_explanations_and_greys_those_whose_lines_changed", async () => {
  const gap: Gap = { path: NEW, said: "added a retry", quote: "added 6", line: 6 };
  const now = daemon({ changed: line => (line === 14 ? "edited 14" : original(line)), readback: { state: "stale", ...account({ gaps: [gap] }) } });

  await open(now);

  await screen.findByText(WIRING.text);
  await waitFor(() => expect(stale()).toEqual(["false", "true"]));
  expect(screen.queryByText(copy.gapSaid("a", gap.said))).toBeNull();
});

/** The elements under the lines of `NEW`, in the order the diff stacks them. */
const stacked = () => {
  const host = drawnIn(NEW)[0];
  const names = [...new Set([...host?.shadowRoot?.querySelectorAll("slot[name]") ?? []].map(slot => slot.getAttribute("name")))];

  return names.flatMap(name => [...host?.children ?? []].filter(child => child.getAttribute("slot") === name));
};

const kind = (element: Element) => element.querySelector(".gap-mark") ? "gap" : element.querySelector(".explained") ? "explanation" : "note";

it("u7699d_a_note_a_gap_and_an_explanation_under_one_line_keep_their_order", async () => {
  const gap: Gap = { path: NEW, said: "added a retry", quote: "added 6", line: 6 };
  const here: LineExplanation = { path: NEW, start: 6, end: 6, source: "added 6", text: "Starts the loader." };

  await open(daemon({ readback: { state: "read", ...account({ explanations: [here], gaps: [gap] }) } }));
  await screen.findByText(here.text);
  press("]");
  await saveNote("a note");

  await waitFor(() => expect(stacked().map(kind)).toEqual(["note", "gap", "explanation"]));

  // Only the note offers an edit: the batch lists one, and no element under the line holds one.
  expect(screen.getAllByRole("button", { name: /^Edit note/ }).length).toBe(1);
  expect(stacked().flatMap(each => [...each.querySelectorAll("button")]).map(button => button.getAttribute("aria-label"))).not.toContain(copy.editNote(1));
});

it("u7699e_an_explanation_is_in_no_note_or_message", async () => {
  const now = daemon({ changed: line => (line === 9 ? "edited 9" : original(line)) });
  const { app } = await open(now);

  await screen.findByText(LOADER.text);
  fireEvent.click(screen.getByRole("button", { name: copy.askAgain }));
  await screen.findByText("Second.");

  expect(app.calls.filter(call => /^(message|pad|todo)\./.test(call.method))).toEqual([]);
  expect(JSON.stringify(app.calls.map(call => call.params))).not.toContain(WIRING.text);
  expect(screen.queryByRole("list", { name: copy.notes })).toBeNull();
  expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull();
  expect(screen.queryByRole("textbox", { name: copy.note })).toBeNull();
});
