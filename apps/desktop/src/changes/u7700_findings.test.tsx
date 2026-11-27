import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { expect, it } from "vitest";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Finding } from "@contracts/agent/Finding";
import type { DefectFindings } from "@contracts/agent/DefectFindings";
import { copy } from "./copy";
import { createFindings, createFound } from "./findings";
import { mountControl } from "./harness";
import { message } from "../testing/centreFixture";
import { openBatch, openChanges } from "./noteHarness";
import {
  calls,
  comparison,
  counted,
  drawn,
  fresh,
  moduleRow,
  pane,
  region,
  setUpView,
  showing,
  text,
  there,
} from "./viewHarness";

setUpView();

// U7700: the defect pass over a fake Daemon whose `agent.findDefects` the test answers.

const NEW = "pkg/src/new.ts";

const FILES = [NEW, "mod/b.ts"].map((path) => counted(path, 17, 17));

const lines = (change: (line: number) => string) =>
  Array.from({ length: 40 }, (_, index) => change(index + 1)).join("\n") + "\n";

const added = (line: number) =>
  line >= 6 && line <= 22 ? `line ${line} new` : `line ${line}`;

const read = (path: string): FileComparison =>
  comparison(path, {
    old: text(
      "old",
      lines((line) => `line ${line}`),
    ),
    new: text("new", lines(added)),
  });

const LOADER: Finding = {
  path: NEW,
  start: 8,
  end: 9,
  source: "line 8 new\nline 9 new",
  text: "The loader never checks for an empty list.",
  label: "issue",
};

const WIRING: Finding = {
  path: NEW,
  start: 14,
  end: 14,
  source: "line 14 new",
  text: "This repeats the cache lookup above.",
  label: "nit",
};

const found = (...findings: Finding[]): DefectFindings => ({
  state: "found",
  findings,
});

type Daemon = {
  blob: string;
  gone: boolean;
  edit: (line: number) => string;
  answer: () => DefectFindings | Promise<DefectFindings>;
};

const daemon = (over: Partial<Daemon> = {}): Daemon => ({
  blob: "one",
  gone: false,
  edit: added,
  answer: () => found(LOADER, WIRING),
  ...over,
});

/** The view over the Tree target, on its Overview. */
const treeOpen = async (now: Daemon) => {
  const mounted = await mountControl(
    () => ({
      files: FILES.flatMap((file) =>
        now.gone && file.path === NEW ? [] : [{ ...file, blob: now.blob }],
      ),
    }),
    fresh(),
  );

  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({
    ...read(path),
    new: { kind: "text", revision: "new-" + now.blob, text: lines(now.edit) },
  });
  mounted.app.handlers["agent.findDefects"] = () => now.answer();
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await waitFor(() => expect(screen.getByRole("radio", { name: copy.targetTree }).getAttribute("aria-checked")).toBe("true"));
  await within(pane()).findByRole("button", { name: copy.findDefects });

  return mounted;
};

const asks = (app: { calls: { method: string }[] }) =>
  calls(app, "agent.findDefects");

const find = () =>
  fireEvent.click(
    within(pane()).getByRole("button", { name: copy.findDefects }),
  );

const toModule = async () => {
  fireEvent.click(await waitFor(() => moduleRow("pkg")));
  await showing(NEW);
  await drawn(NEW);
};

const toOverview = () =>
  fireEvent.click(there(region().querySelector('[data-row="overview"]')));

const regions = () => screen.getAllByRole("region", { name: copy.finding });

const finding = (index: number) => {
  const found = regions()[index];

  if (!found) throw new Error("no finding at " + index);

  return found;
};

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Tree list reads again when the target changes; a new blob id then makes the pass stale. */
const relist = async () => {
  fireEvent.click(screen.getByRole("radio", { name: copy.targetBranch }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("radio", { name: copy.targetBranch })
        .getAttribute("aria-checked"),
    ).toBe("true"),
  );
  fireEvent.click(screen.getByRole("radio", { name: copy.targetTree }));
};

it("u7700a_only_the_user_starts_the_pass_and_a_comparison_without_a_tree_offers_none", async () => {
  let release: (value: DefectFindings) => void = () => {};

  const { app } = await treeOpen(
    daemon({
      answer: () =>
        new Promise<DefectFindings>((resolve) => {
          release = resolve;
        }),
    }),
  );

  // Opening the view and a wait call nothing; the button has no visible text.
  await tick();
  expect(asks(app)).toBe(0);
  expect(
    within(pane()).getByRole("button", { name: copy.findDefects }).textContent,
  ).toBe("");

  // One click asks once, with the Agent and the open `to`; a click while it runs asks nothing more.
  find();
  await within(pane()).findByRole("status");
  expect(
    within(pane()).queryByRole("button", { name: copy.findDefects }),
  ).toBeNull();
  expect(
    app.calls
      .filter((call) => call.method === "agent.findDefects")
      .map((call) => call.params),
  ).toEqual([{ id: "a", to: "tree" }]);
  release(found());

  // U7955a: the Changes comparison offers it too, and asks with the open group alone.
  fireEvent.click(screen.getByRole("radio", { name: copy.changes }));
  await waitFor(() => expect(screen.getByRole("radio", { name: copy.changes }).getAttribute("aria-checked")).toBe("true"));
  find();
  await waitFor(() => expect(asks(app)).toBe(2));
  expect(
    app.calls
      .filter((call) => call.method === "agent.findDefects")
      .map((call) => call.params)
      .at(-1),
  ).toMatchObject({ id: "a", group: expect.anything() });
});

it("u7700b_every_state_is_drawn_and_the_view_stays_usable", async () => {
  let release: (value: DefectFindings) => void = () => {};

  const now = daemon({
    answer: () =>
      new Promise<DefectFindings>((resolve) => {
        release = resolve;
      }),
  });

  const { app } = await treeOpen(now);

  expect(within(pane()).getByText(copy.findingsQuiet)).toBeTruthy();

  // Running: the tree and the module scroll still answer.
  find();
  await within(pane()).findByText(copy.lookingForDefects);
  await toModule();
  toOverview();
  await within(pane()).findByText(copy.lookingForDefects);

  // Done: the count and the list; none found says so.
  release(found(LOADER, WIRING));
  expect(await within(pane()).findByText(copy.findingsCount(2))).toBeTruthy();
  expect(within(pane()).getAllByRole("listitem").length).toBeGreaterThanOrEqual(
    2,
  );

  // Stale: another blob id adds the line and Find again asks once more.
  now.blob = "two";
  now.answer = () => found();
  await relist();
  await within(pane()).findByText(copy.changedSinceReadback, { exact: false });
  fireEvent.click(within(pane()).getByRole("button", { name: copy.findAgain }));
  await within(pane()).findByText(copy.noFindings);
  expect(asks(app)).toBe(2);
  expect(
    within(pane()).queryByText(copy.changedSinceReadback, { exact: false }),
  ).toBeNull();

  // Failed: the cause in words and Retry asks once.
  now.answer = () => ({
    state: "failed",
    kind: "badAnswer",
    cause: "the answer is not findings",
  });
  now.blob = "three";
  await relist();
  await waitFor(() => {
    fireEvent.click(
      within(pane()).getByRole("button", { name: copy.findAgain }),
    );
    expect(asks(app)).toBe(3);
  });
  await within(pane()).findByText("the answer is not findings");
  fireEvent.click(within(pane()).getByRole("button", { name: copy.retry }));
  await waitFor(() => expect(asks(app)).toBe(4));
});

it("u7700c_a_finding_draws_under_its_line_and_counts_in_its_row_and_joins_no_batch", async () => {
  const { app } = await treeOpen(daemon());

  find();
  await within(pane()).findByText(copy.findingsCount(2));
  await toModule();

  await waitFor(() => expect(regions().length).toBe(2));
  expect(regions().every((each) => document.body.contains(each))).toBe(true);
  expect(
    within(finding(0)).getByText(copy.labels.issue),
  ).toBeTruthy();
  expect(
    within(finding(1)).getByText(copy.labels.nit),
  ).toBeTruthy();
  expect(moduleRow("pkg").getAttribute("aria-label")).toContain(
    copy.findingsCount(2),
  );
  expect([1, 2].map((count) => screen.queryByRole("button", { name: copy.noteCount(count) }))).toEqual([null, null]);
  expect(
    app.calls.filter((call) => /^(message|pad|todo)\./.test(call.method)),
  ).toEqual([]);
});

it("u7700d_keep_makes_an_unsent_editable_note_that_sends_only_on_send_and_drop_makes_none", async () => {
  const { app } = await treeOpen(daemon());

  find();
  await within(pane()).findByText(copy.findingsCount(2));
  await toModule();
  await waitFor(() => expect(regions().length).toBe(2));

  // Keep: the first finding becomes a note and leaves the list; the second is dropped and leaves no note.
  fireEvent.click(
    within(finding(0)).getByRole("button", {
      name: copy.keepFinding,
    }),
  );
  await waitFor(() => expect(regions().length).toBe(1));
  fireEvent.click(
    within(finding(0)).getByRole("button", {
      name: copy.dropFinding,
    }),
  );
  await waitFor(() =>
    expect(screen.queryAllByRole("region", { name: copy.finding }).length).toBe(
      0,
    ),
  );
  await openBatch();
  expect(screen.getAllByRole("button", { name: /^Edit note/ }).length).toBe(1);
  expect(calls(app, "message.send")).toBe(0);

  // Only Send reaches the Agent, once, with the kept note's label and sentence.
  app.handlers["message.send"] = (params) =>
    message(1, { body: params.body, to: params.to });
  fireEvent.click(screen.getByRole("button", { name: /Send notes:/ }));
  await waitFor(() => expect(calls(app, "message.send")).toBe(1));

  const sent = JSON.stringify(
    app.calls.find((call) => call.method === "message.send")?.params,
  );

  expect(sent).toContain(LOADER.text);
  expect(sent).toContain("issue");
  expect(sent).not.toContain(WIRING.text);
});

it("u7700d_a_full_batch_leaves_the_finding", async () => {
  // SAFETY: the pass reads only `app.rpc` and a kept finding only `notes.save`; the doubles answer those two.
  const state = createRoot(() =>
    createFindings({
      app: { rpc: async () => found(LOADER) } as never,
      id: "a",
      at: () => ({ to: "tree" }),
      grouped: () => ({ modules: [], noise: [] }),
      signature: () => "",
      kept: createFound(),
      notes: { save: async () => false } as never,
    }),
  );

  state.ask();
  await waitFor(() => expect(state.list()).toEqual([LOADER]));
  await state.keep(LOADER, read(NEW));

  expect(state.list()).toEqual([LOADER]);
});

it("u7700e_a_finding_whose_lines_changed_greys_and_a_gone_file_is_listed_unlinked", async () => {
  const now = daemon();
  const { app } = await treeOpen(now);

  find();
  await within(pane()).findByText(copy.findingsCount(2));
  await toModule();
  await waitFor(() => expect(regions().length).toBe(2));

  // A write over the first one's lines greys it alone and offers Drop only.
  now.blob = "two";
  now.edit = (line) => (line === 9 ? "edited 9" : added(line));
  await relist();
  fireEvent.click(await waitFor(() => moduleRow("pkg")));
  await waitFor(() =>
    expect(regions().map((each) => each.getAttribute("data-changed"))).toEqual([
      "true",
      "false",
    ]),
  );
  expect(
    within(finding(0)).queryByRole("button", {
      name: copy.keepFinding,
    }),
  ).toBeNull();
  expect(
    within(finding(0)).getByRole("button", {
      name: copy.dropFinding,
    }),
  ).toBeTruthy();
  expect(
    within(finding(1)).getByRole("button", {
      name: copy.keepFinding,
    }),
  ).toBeTruthy();

  // The Overview links a finding whose file is listed.
  toOverview();

  const opens = () =>
    within(pane()).queryAllByRole("button", {
      name: new RegExp(`^${copy.openGap(NEW)}`),
    });

  expect(opens().length).toBe(2);

  // Once the file left the listing the same words stay, unlinked, with Drop only.
  now.gone = true;
  now.blob = "three";
  await relist();
  await waitFor(toOverview);
  await within(pane()).findByText(copy.changedSinceReadback, { exact: false });
  expect(opens().length).toBe(0);
  expect(
    within(pane()).getAllByRole("button", { name: copy.dropFinding }).length,
  ).toBe(2);
  expect(within(pane()).getByText(LOADER.text, { exact: false })).toBeTruthy();
  expect(asks(app)).toBe(1);
});

it("u7700f_a_pass_outlives_the_view_for_the_session", async () => {
  const { app } = await treeOpen(daemon());

  find();
  await within(pane()).findByText(copy.findingsCount(2));

  fireEvent.keyDown(region(), { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: copy.changes })).toBeNull(),
  );
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  await waitFor(toOverview);

  expect(await within(pane()).findByText(copy.findingsCount(2))).toBeTruthy();
  expect(asks(app)).toBe(1);
});
