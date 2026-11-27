import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { Explanation } from "@contracts/agent/Explanation";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges } from "./noteHarness";
import { at, calls, comparison, content, counted, drawn, edited, fresh, marks, moduleRow, press, section, setUpView, showing, text } from "./viewHarness";

setUpView();

// U7698: the explanation of selected lines, over a fake Daemon whose `agent.explain` the test answers.

const NEW = "pkg/src/new.ts";

const FILES = [NEW, "mod/b.ts"].map(path => counted(path, 17, 17));

const lines = (change: (line: number) => string) => Array.from({ length: 40 }, (_, index) => change(index + 1)).join("\n") + "\n";

const read = (path: string): FileComparison => comparison(path, { old: text("old", lines(line => `line ${line}`)), new: text("new", lines(line => line >= 6 && line <= 22 ? `line ${line} new` : `line ${line}`)) });

const CAUSE = "the model answered in prose";

const words = (body: string): Explanation => ({ state: "explained", form: "words", text: body });

const diagram: Explanation = { state: "explained", form: "diagram", text: "Before\nrun -> load\nAfter\nrun -> cache -> load" };

type Daemon = { blobs: Record<string, string>; explain: (params: { form: string }) => Explanation | Promise<Explanation> };

/** The view over the Tree target with the module of `NEW` open and drawn; `daemon` answers each ask. */
const open = async (daemon: Daemon) => {
  const mounted = await mountControl(() => ({ files: FILES.map(file => ({ ...file, blob: daemon.blobs[file.path] ?? "one" })) }), fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => read(path);
  mounted.app.handlers["agent.explain"] = params => daemon.explain(params);
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  fireEvent.click(await waitFor(() => moduleRow("pkg")));
  await showing(NEW);
  await drawn(NEW);

  return mounted;
};

const waiting = (): Daemon & { answer: (value: Explanation) => void } => {
  const pending: ((value: Explanation) => void)[] = [];
  const daemon = { blobs: {}, answer: (value: Explanation) => { for (const resolve of pending.splice(0)) resolve(value); }, explain: () => new Promise<Explanation>(resolve => { pending.push(resolve); }) };

  return daemon;
};

/** U7693c: the Tree list reads again when the target changes; the Branch list answers the same files. */
const relist = async () => {
  fireEvent.click(screen.getByRole("radio", { name: copy.targetBranch }));
  await waitFor(() => expect(screen.getByRole("radio", { name: copy.targetBranch }).getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(screen.getByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(moduleRow("mod").getAttribute("aria-selected")).toBe("true"));
  fireEvent.click(moduleRow("pkg"));
  await waitFor(() => expect(moduleRow("pkg").getAttribute("aria-selected")).toBe("true"));
  await showing(NEW);
  await drawn(NEW);
};

const asks = (app: { calls: { method: string }[] }) => calls(app, "agent.explain");

const asked = (app: { calls: { method: string; params?: unknown }[] }) => app.calls.filter(call => call.method === "agent.explain").map(call => call.params);

const diffContent = () => content(NEW) ?? document.body;

const wordsButton = () => screen.getByRole("button", { name: copy.explainWords });

const explanation = () => screen.getByRole("region", { name: copy.explanation });

it("u7698a_only_the_user_asks_and_a_comparison_without_a_tree_offers_none", async () => {
  const daemon = waiting();
  const { app } = await open(daemon);

  // Opening, selecting lines, a turn that wrote and a wait call nothing.
  press("]");
  await marks(at("old", 6));
  edited(app, "a");
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(asks(app)).toBe(0);

  // The header's two buttons and W and D ask once each; the same ask while it waits asks nothing more.
  fireEvent.click(wordsButton());
  fireEvent.click(wordsButton());
  expect(asked(app)).toEqual([{ id: "a", to: "tree", path: NEW, side: "old", start: 6, end: 6, form: "words" }]);
  press("d", diffContent());
  expect(asked(app).at(-1)).toEqual({ id: "a", to: "tree", path: NEW, side: "old", start: 6, end: 6, form: "diagram" });
  fireEvent.click(screen.getByRole("button", { name: copy.explainDiagram }));
  expect(asks(app)).toBe(2);
});

it("u7698b_asking_keeps_the_view_usable_and_the_answer_shows_under_the_lines", async () => {
  const daemon = waiting();
  const { app } = await open(daemon);

  fireEvent.click(wordsButton());
  expect((await screen.findByText(copy.readingBack)).getAttribute("role")).toBe("status");

  // The view answers a key while it waits.
  press("]");
  await marks(at("old", 6));
  press("w", diffContent());
  expect(asked(app)).toEqual([expect.objectContaining({ start: 1 }), expect.objectContaining({ start: 6 })]);

  daemon.answer(words("It adds a retry."));
  expect((await screen.findAllByText("It adds a retry.")).length).toBe(2);
  expect(screen.getAllByText(copy.readbackCredit).length).toBe(2);
  expect(screen.queryByText(copy.readingBack)).toBeNull();
  expect(section(NEW)?.contains(screen.getAllByRole("region", { name: copy.explanation })[0] ?? null)).toBe(true);
});

it("u7698b_a_diagram_answer_draws_its_calls_as_words", async () => {
  await open({ blobs: {}, explain: () => diagram });

  fireEvent.click(screen.getByRole("button", { name: copy.explainDiagram }));
  expect(await screen.findByText(copy.diagramCalls("run", "load"))).toBeTruthy();
  expect(screen.getByText(copy.diagramCalls("cache", "load"))).toBeTruthy();
  expect(screen.getByText(copy.diagramBefore)).toBeTruthy();
});

it("u7698b_a_failed_ask_says_why_and_retry_asks_once", async () => {
  const outcomes: Explanation[] = [{ state: "failed", kind: "badAnswer", cause: CAUSE }, words("Second try.")];
  const { app } = await open({ blobs: {}, explain: () => outcomes.shift() ?? words("none") });

  fireEvent.click(wordsButton());
  await screen.findByText(copy.explainFailed, { exact: false });
  await within(explanation()).findByText(CAUSE);
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await screen.findByText("Second try.");
  expect(asks(app)).toBe(2);
});

it("u7698c_a_write_to_the_file_makes_the_answer_stale_and_ask_again_asks_once", async () => {
  const replies = [words("First."), words("Second.")];
  const daemon: Daemon = { blobs: {}, explain: () => replies.shift() ?? words("none") };
  const { app } = await open(daemon);

  fireEvent.click(wordsButton());
  await screen.findByText("First.");

  // A write to another file leaves it as it was.
  daemon.blobs["mod/b.ts"] = "two";
  await relist();
  expect(explanation().getAttribute("data-stale")).toBe("false");

  // A write to its file dims it, and Ask again asks once more and replaces it.
  daemon.blobs[NEW] = "two";
  await relist();
  await waitFor(() => expect(explanation().getAttribute("data-stale")).toBe("true"));
  expect(screen.getByText(copy.changedSinceReadback, { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: copy.askAgain }));
  await screen.findByText("Second.");
  expect(asks(app)).toBe(2);
  expect(explanation().getAttribute("data-stale")).toBe("false");
});

it("u7698d_an_explanation_is_in_no_note_or_message", async () => {
  const { app } = await open({ blobs: {}, explain: () => words("It adds a retry.") });

  fireEvent.click(wordsButton());
  await screen.findByText("It adds a retry.");

  expect(app.calls.filter(call => /^(message|pad|todo)\./.test(call.method))).toEqual([]);
  expect(JSON.stringify(app.calls.map(call => call.params))).not.toContain("It adds a retry.");
  expect(screen.queryByRole("list", { name: copy.notes })).toBeNull();
  expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull();
});

it("u7698e_an_answer_outlives_the_view_for_the_session", async () => {
  const { app } = await open({ blobs: {}, explain: () => words("Kept for now.") });

  fireEvent.click(wordsButton());
  await screen.findByText("Kept for now.");

  press("Escape");
  await waitFor(() => expect(screen.queryByRole("region", { name: copy.changes })).toBeNull());
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });

  await screen.findByText("Kept for now.");
  expect(asks(app)).toBe(1);
});
