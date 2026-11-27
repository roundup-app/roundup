import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createActor, createMachine } from "xstate";
import type { Account } from "@contracts/agent/Account";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Readback } from "@contracts/agent/Readback";
import type { Pad } from "@contracts/pad/Pad";
import { copy as padCopy } from "../pads/copy";
import { IconStatechart } from "../pads/IconStatechart";
import type { Layout, Statechart, StatechartApi } from "../pads/statechartBlock";
import { bundledRenderers, useRenderers } from "../pads/visualKinds";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges } from "./noteHarness";
import { counted, comparison, fresh, pane, setUpView, text } from "./viewHarness";

setUpView();

// U7709: the readback's diagram holds a statechart block, over a fake Daemon that answers `agent.readback` and `pad.create`.

let loads = 0;

const api: StatechartApi = {
  createMachine: (config) => {
    // SAFETY: the config is a plain states map with string targets, which `createMachine` accepts.
    const machine = createMachine(config as never);

    return () => createActor(machine);
  },
  layout: async (boxes, moves): Promise<Layout> => ({
    width: 100,
    height: 100,
    boxes: Object.fromEntries(boxes.map(([id], at) => [id, { x: at * 10, y: 0 }])),
    routes: Object.fromEntries(moves.map(([key]) => [key, [{ x: 0, y: 0 }, { x: 5, y: 5 }]])),
    labels: Object.fromEntries(moves.map(([key]) => [key, { x: 2, y: 2 }])),
  }),
};

beforeEach(() => {
  loads = 0;
  useRenderers({
    ...bundledRenderers,
    statechart: async () => {
      loads += 1;

      return api;
    },
  });
});

afterEach(() => useRenderers(bundledRenderers));

const CHART: Statechart = {
  summary: "While a Pad saves it shows one of four states.",
  writtenBy: "the readback",
  rules: [{ id: "r1", name: "Saved hides nothing", verdict: "broken" }],
  states: [
    { id: "a", label: "Saved", values: { Version: "0" }, breaks: [] },
    { id: "b", label: "Unsaved", values: { Version: "1" }, breaks: [] },
    { id: "c", label: "Far", values: {}, breaks: [] },
    { id: "d", label: "Hidden edit", values: { Version: "2" }, breaks: ["r1"] },
  ],
  start: "a",
  steps: [
    { from: "a", to: "b", label: "you type" },
    { from: "b", to: "c", label: "you wait" },
    { from: "c", to: "d", label: "far edit" },
    { from: "a", to: "d", label: "outside edit" },
  ],
  stopped: "The check stopped at one outside edit.",
};

const block = (chart: Statechart = CHART) => "```statechart\n" + JSON.stringify(chart) + "\n```";

const CALLS = "Before\nrun -> load\nAfter\nrun -> cache -> load";

const account = (diagram: string, over: Partial<Account> = {}): Account => ({
  overview: "Changes how a Pad saves.",
  diagram,
  flows: [],
  modules: [],
  unplaced: [],
  ranks: [],
  risks: [],
  explanations: [],
  stops: [],
  gaps: [],
  ...over,
});

const result = (state: "read" | "stale", diagram: string, over: Partial<Account> = {}): Readback => ({ state, ...account(diagram, over) });

const FILES = [counted("pkg/src/new.ts", 3, 3)];

const read = (path: string): FileComparison => comparison(path, { old: text("old", "a\n"), new: text("new", "b\n") });

const treeOpen = async (answer: Readback) => {
  const mounted = await mountControl(() => ({ files: FILES }), fresh(), undefined, IconStatechart);

  mounted.app.handlers["agent.compareFile"] = ({ path }) => read(path);
  mounted.app.handlers["agent.readback"] = () => answer;
  mounted.app.handlers["pad.create"] = ({ name }) => ({ incarnation: "i", name, text: "", updated_at: 0, revision: 1, home: null, visibility: "shown", creator: { kind: "user", id: "you", parent: null } }) satisfies Pad;

  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  return mounted;
};

const drawn = () => waitFor(() => expect(pane().querySelector(".statechart-box")).not.toBeNull());

const lit = () => pane().querySelector<HTMLElement>(".statechart-box.is-lit")?.dataset.state;

const named = (name: string) => within(pane()).getByRole("button", { name });

const must = <Item,>(item: Item | null | undefined): Item => {
  if (item === null || item === undefined) throw new Error("expected the element to exist");

  return item;
};

const moveButton = (name: string) => must([...pane().querySelectorAll<HTMLButtonElement>(".statechart-move-list button")].find((node) => node.textContent === name));

it("u7709a_a_diagram_with_a_statechart_block_draws_the_chart_and_the_user_steps_it", async () => {
  const { app } = await treeOpen(result("read", block()));

  await drawn();
  expect(pane().querySelector(".statechart-summary")?.textContent).toBe(CHART.summary);
  expect(pane().querySelector(".statechart-credit")?.textContent).toBe(padCopy.statechartCredit(CHART.writtenBy));
  expect([...pane().querySelectorAll(".statechart-rule")].map((rule) => rule.textContent)).toEqual([padCopy.statechartRule("Saved hides nothing", "broken")]);
  expect(lit()).toBe("a");

  const before = app.calls.length;

  fireEvent.click(moveButton("you type"));
  expect(lit()).toBe("b");
  fireEvent.click(named(padCopy.walkBack));
  expect(lit()).toBe("a");
  fireEvent.click(moveButton("you type"));
  fireEvent.click(named(padCopy.statechartStartOver));
  expect(lit()).toBe("a");
  fireEvent.click(named(padCopy.statechartWalk));
  expect(lit()).toBe("d");
  expect(pane().querySelector(".statechart-bar")?.textContent).toBe(padCopy.statechartBreaks("Saved hides nothing"));
  fireEvent.click(named(padCopy.statechartDetails));
  expect(pane().querySelector(".statechart-details")?.textContent).toContain(CHART.stopped);
  expect(app.calls.length).toBe(before);
});

it("u7709b_a_diagram_without_a_block_draws_as_before_and_requests_no_chart_loader", async () => {
  await treeOpen(result("read", CALLS));
  await screen.findByText("Changes how a Pad saves.");
  await waitFor(() => expect(pane().querySelector(".readback-figure")).not.toBeNull());
  expect(pane().querySelector(".visual-statechart")).toBeNull();
  expect(loads).toBe(0);
});

it("u7709b_a_block_and_calls_draw_both_and_the_stops_keep_to_the_calls", async () => {
  const stops = [{ part: "run", text: "The run starts." }, { part: "Saved", text: "A state, not a part." }, { part: "load", text: "The loader answers." }];

  await treeOpen(result("read", CALLS + "\n\n" + block() + "\n", { stops }));
  await drawn();
  expect(pane().querySelectorAll(".readback-words li").length).toBeGreaterThan(0);
  expect(within(await screen.findByRole("group", { name: copy.stepDiagram })).getByRole("status").textContent).toContain(copy.stopCount(1, 2));
  expect(pane().querySelector(".statechart-credit")).not.toBeNull();
});

it("u7709c_the_charts_controls_are_icon_buttons_with_their_names", async () => {
  await treeOpen(result("read", block()));
  await drawn();

  for (const name of [padCopy.walkBack, padCopy.statechartStartOver, padCopy.statechartWalk, padCopy.statechartDetails]) {
    const button = named(name);

    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
  }

  expect(named(padCopy.statechartDetails).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(named(padCopy.statechartDetails));
  expect(named(padCopy.statechartDetails).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(named(padCopy.statechartWalk));
  expect(named(padCopy.statechartWalk).getAttribute("aria-disabled")).toBe("true");
});

it("u7709c_a_chart_whose_rules_all_hold_offers_no_walk", async () => {
  await treeOpen(result("read", block({ ...CHART, rules: [{ id: "r1", name: "Saved hides nothing", verdict: "holds" }], states: CHART.states.map((state) => ({ ...state, breaks: [] })) })));
  await drawn();
  expect(within(pane()).queryByRole("button", { name: padCopy.statechartWalk })).toBeNull();
});

it("u7709d_a_stale_readback_keeps_its_chart_and_a_bad_block_shows_its_cause", async () => {
  await treeOpen(result("stale", block()));
  await drawn();
  expect(pane().querySelector('[data-stale="true"] .visual-statechart')).not.toBeNull();
  fireEvent.click(moveButton("you type"));
  expect(lit()).toBe("b");
});

it("u7709d_a_block_that_fails_to_read_shows_its_source_and_its_cause", async () => {
  const bad = { ...CHART, start: "zz" };

  await treeOpen(result("read", CALLS + "\n\n" + block(bad) + "\n"));
  await screen.findByText(padCopy.statechart(padCopy.statechartNoState("start", "zz")));
  expect(pane().querySelector(".visual-statechart pre")?.textContent).toBe(JSON.stringify(bad));
  await waitFor(() => expect(pane().querySelector(".readback-figure")).not.toBeNull());
});

it("u7709e_save_as_pad_writes_the_statechart_block_byte_for_byte", async () => {
  const { app } = await treeOpen(result("read", CALLS + "\n\n" + block() + "\n"));

  fireEvent.click(await screen.findByRole("button", { name: copy.savePad }));
  await waitFor(() => expect(app.calls.some((call) => call.method === "pad.create")).toBe(true));

  // SAFETY: the call read is a `pad.create`, whose params are `{ name, text }`.
  const body = (must(app.calls.find((call) => call.method === "pad.create")).params as { text: string }).text;

  expect(body).toContain(block());
  expect(body).toContain("```mermaid");
});
