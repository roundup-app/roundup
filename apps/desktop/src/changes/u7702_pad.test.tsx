import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { Account } from "@contracts/agent/Account";
import type { Readback } from "@contracts/agent/Readback";
import type { Pad } from "@contracts/pad/Pad";
import { unknownOutcomeLine } from "../app/failureOf";
import { RpcError } from "../app/seam";
import { agent, event, workstream } from "../testing/nodes";
import { copy } from "./copy";
import { mountControl, WORKTREE } from "./harness";
import { openChanges, openOverview } from "./noteHarness";
import { readbackText } from "./readbackPad";
import { counted, edited, fresh, pane, setUpView } from "./viewHarness";

setUpView();

// U7702: the user saves a read readback as a Pad, over a fake Daemon that answers `agent.readback`, `pad.create` and `pad.move`.

const FILES = ["pkg/src/new.ts", "mod/b.ts"].map(path => counted(path, 3, 3));

const ACCOUNT: Account = {
  overview: "Adds a loader and wires it into run.",
  diagram: "Before\nrun -> load\nAfter\nrun -> cache -> load",
  flows: [{ id: "f1", name: "Load a file", source: "readback", steps: [{ note: "run asks the cache first", hunks: ["pkg/src/new.ts#1"] }, { note: "the cache falls back to load", hunks: ["mod/b.ts#1"] }] }],
  modules: [{ module: "pkg", account: "Loads data through a cache." }],
  unplaced: [],
  ranks: [],
  risks: [],
  explanations: [], stops: [],
  gaps: [{ path: "pkg/src/new.ts", said: "added a retry", quote: "line 10 new", line: 10 }],
};

const result = (state: "read" | "stale", over: Partial<Account> = {}): Readback => ({ state, ...ACCOUNT, ...over });

const padOf = (name: string): Pad => ({ incarnation: `i-${name}`, name, text: "", updated_at: 0, revision: 1, home: null, visibility: "shown", creator: { kind: "user", id: "you", parent: null } });

/** The day of the fake clock as the Pad's name writes it. */
const DAY = (() => {
  const day = new Date(1_700_000_000_000);

  return [day.getFullYear(), day.getMonth() + 1, day.getDate()].map(part => String(part).padStart(2, "0")).join("-");
})();

const NAME = `Readback: a ${DAY}`;

/** A cause the fake Daemon gives. */
const REFUSAL = "The Daemon refused.";

type Answering = { state: Readback };

/** The view over the Tree target for Agent `a`, which sits under Workstream `w1` unless `rooted`; `taken` are the Pad names the Daemon refuses, and `pad.move` fails with `moving`. */
const treeOpen = async (answer: Answering, options: { rooted?: boolean; taken?: string[]; moving?: string } = {}) => {
  const mounted = await mountControl(() => ({ files: FILES }), fresh());
  const { app } = mounted;
  const taken = new Set((options.taken ?? []).map(name => name.toLowerCase()));

  if (!options.rooted) {
    app.handlers["rail.tree"] = () => [workstream("w1"), agent("a", "working", "building", { worktree: WORKTREE, parent: "w1" })];
    app.emit(event({ name: "rail.changed" }));
    await waitFor(() => expect(mounted.connected.rail.nodes.find(node => node.id === "a")?.parent).toBe("w1"));
  }

  app.handlers["agent.readback"] = () => answer.state;
  app.handlers["agent.readbackStart"] = () => {
    answer.state = { state: "reading" };

    return answer.state;
  };

  app.handlers["pad.create"] = ({ name }) => {
    if (taken.has(name.toLowerCase())) throw new RpcError(-32003, "That name is taken.");

    taken.add(name.toLowerCase());

    return padOf(name);
  };

  app.handlers["pad.move"] = ({ name }) => {
    if (options.moving) throw new RpcError(-32010, options.moving);

    return padOf(name);
  };

  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await openOverview();

  return mounted;
};

const padCalls = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter(call => call.method.startsWith("pad."));

const saveButton = () => screen.findByRole("button", { name: copy.savePad });

const save = async () => fireEvent.click(await saveButton());

// SAFETY: every call this file reads is a `pad.create`, whose params are `{ name, text }`.
const textOf = (call: { params: unknown } | undefined) => (call?.params as { text: string } | undefined)?.text ?? "";

it("u7702a_the_save_action_shows_with_a_read_or_stale_result_and_nothing_saves_unasked", async () => {
  const answer: Answering = { state: { state: "notRead" } };
  const { app } = await treeOpen(answer);

  await screen.findByRole("button", { name: copy.readBack });
  expect(screen.queryByRole("button", { name: copy.savePad })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: copy.readBack }));
  await screen.findByText(copy.readingBack);
  expect(screen.queryByRole("button", { name: copy.savePad })).toBeNull();

  answer.state = { state: "failed", kind: "call", cause: "no model" };
  await screen.findByText("no model", {}, { timeout: 3000 });
  expect(screen.queryByRole("button", { name: copy.savePad })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  answer.state = result("read");

  const button = await saveButton();

  expect(button.textContent).toBe("");

  answer.state = result("stale");
  edited(app, "a");
  app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "done", label: "done", since: 0, finished: "1" } } }));
  await screen.findByText(copy.changedSinceReadback);
  expect(screen.getByRole("button", { name: copy.savePad })).toBeTruthy();
  expect(padCalls(app)).toEqual([]);
});

it("u7702b_one_click_creates_the_pad_then_moves_it_to_the_workstream", async () => {
  const { app } = await treeOpen({ state: result("read") });

  await save();
  expect(await screen.findByText(copy.padSaved(NAME))).toBeTruthy();

  const made = padCalls(app);

  expect(made.map(call => call.method)).toEqual(["pad.create", "pad.move"]);
  expect(made[1]?.params).toEqual({ name: NAME, home: "w1" });
  expect(app.calls.filter(call => call.method.startsWith("message.") || call.method === "pad.write")).toEqual([]);

  const body = textOf(made[0]);

  for (const part of [NAME, DAY, copy.remoteMain, copy.targetTree, ACCOUNT.overview, "```mermaid", "Load a file", "run asks the cache first", "the cache falls back to load", "Loads data through a cache.", copy.gapSaid("a", "added a retry"), "pkg/src/new.ts"]) expect(body).toContain(part);

  // The Drawer stays where it was: nothing opens on the new Pad.
  expect(pane()).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("u7702b_an_agent_under_no_workstream_saves_at_the_project_root", async () => {
  const { app } = await treeOpen({ state: result("read") }, { rooted: true });

  await save();
  expect(await screen.findByText(copy.padSaved(NAME))).toBeTruthy();
  expect(padCalls(app).map(call => call.method)).toEqual(["pad.create"]);
});

it("u7702c_a_failed_move_leaves_the_pad_at_the_root_and_says_so", async () => {
  const { app } = await treeOpen({ state: result("read") }, { moving: REFUSAL });

  await save();
  expect(await screen.findByText(copy.padNotMoved(NAME))).toBeTruthy();
  expect(screen.getByText(copy.padNotMoved(NAME)).querySelector(".flow-cause")?.textContent).toBeTruthy();
  expect(padCalls(app).map(call => call.method)).toEqual(["pad.create", "pad.move"]);
});

it("u7702c_a_failed_create_saves_nothing_and_says_so", async () => {
  const { app } = await treeOpen({ state: result("read") });

  app.handlers["pad.create"] = () => { throw new RpcError(-32602, REFUSAL); };

  await save();
  expect(await screen.findByText(copy.padNotSaved)).toBeTruthy();
  expect(screen.getByText(copy.padNotSaved).querySelector(".flow-cause")?.textContent).toBeTruthy();
  expect(padCalls(app).map(call => call.method)).toEqual(["pad.create"]);
});

it("u7702c_a_create_with_no_answer_says_so_and_repeats_nothing", async () => {
  const { app } = await treeOpen({ state: result("read") });

  app.handlers["pad.create"] = () => { throw new Error("no reply within 8s"); };

  await save();
  expect(await screen.findByText(unknownOutcomeLine(new Error("no answer")))).toBeTruthy();
  expect(padCalls(app).map(call => call.method)).toEqual(["pad.create"]);
});

it("u7702d_saving_twice_makes_two_pads_and_a_stale_readback_saves_its_old_text", async () => {
  const answer: Answering = { state: result("read") };
  const { app } = await treeOpen(answer, { taken: [] });

  await save();
  await screen.findByText(copy.padSaved(NAME));

  answer.state = result("stale", { overview: "An older account of the loader." });
  edited(app, "a");
  app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "done", label: "done", since: 0, finished: "1" } } }));
  await screen.findByText(copy.changedSinceReadback);
  await save();
  await screen.findByText(copy.padSaved(`${NAME} 2`));

  const created = padCalls(app).filter(call => call.method === "pad.create");

  // The second save asks for the same name, is refused, and takes the next.
  // SAFETY: a `pad.create`'s params are `{ name, text }`.
  expect(created.map(call => (call.params as { name: string }).name)).toEqual([NAME, NAME, `${NAME} 2`]);
  expect(textOf(created[0])).not.toContain(copy.changedSinceReadback);
  expect(textOf(created[2])).toContain(copy.changedSinceReadback);
  expect(textOf(created[2])).toContain("An older account of the loader.");
});

it("u7702d_a_taken_name_gets_a_suffix", async () => {
  const { app } = await treeOpen({ state: result("read") }, { taken: [NAME.toUpperCase(), `${NAME} 2`.toUpperCase()] });

  await save();
  await screen.findByText(copy.padSaved(`${NAME} 3`));
  expect(padCalls(app).filter(call => call.method === "pad.create")).toHaveLength(3);
});

it("u7702e_the_diagram_becomes_one_mermaid_block_for_each_panel_and_words_stay_text", () => {
  const input = { agent: "a", day: DAY, from: "remote main", to: "Tree", stale: false };
  const drawn = readbackText({ ...input, account: { ...ACCOUNT, diagram: 'Before\nrun -> say "hi" now\nAfter\nrun -> cache -> load\nThe cache is new.', flows: [], modules: [], gaps: [] } });

  expect(drawn.match(/```mermaid/g)).toHaveLength(2);
  expect(drawn).toContain('n1["say #34;hi#34; now"]');
  expect(drawn).toContain('n0["run"] --> n1["cache"]');
  expect(drawn.indexOf("**Before**")).toBeLessThan(drawn.indexOf("```mermaid"));
  expect(drawn).toContain("- The cache is new.");
  expect(drawn).not.toContain("## Flows");

  const words = readbackText({ ...input, account: { ...ACCOUNT, diagram: "The parts are unchanged." } });

  expect(words).not.toContain("```mermaid");
  expect(words).toContain("- The parts are unchanged.");
});
