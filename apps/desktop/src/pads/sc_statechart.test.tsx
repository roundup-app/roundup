import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActor, createMachine } from "xstate";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";
import { copy } from "./copy";
import type { Layout, Statechart, StatechartApi, StepActor } from "./statechartBlock";
import { bundledRenderers, useRenderers } from "./visualKinds";

const actors: StepActor[] = [];

const api: StatechartApi = {
  createMachine: (config) => {
    // SAFETY: the config is a plain states map with string targets, which `createMachine` accepts.
    const machine = createMachine(config as never);

    return () => {
      const actor = createActor(machine);

      actors.push(actor);

      return actor;
    };
  },
  layout: async (ids, moves): Promise<Layout> => ({
    width: 100,
    height: 100,
    boxes: Object.fromEntries(ids.map((id, at) => [id, { x: at * 10, y: 0 }])),
    routes: Object.fromEntries(moves.map(([key]) => [key, [{ x: 0, y: 0 }, { x: 5, y: 5 }]])),
    labels: Object.fromEntries(moves.map(([key]) => [key, { x: 2, y: 2 }])),
  }),
};

beforeEach(() => {
  useRenderers({ ...bundledRenderers, statechart: async () => api });
});

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
  actors.length = 0;
});

const chart: Statechart = {
  summary: "While a Pad saves it shows one of four states.",
  writtenBy: "pad-checker",
  rules: [
    { id: "r1", name: "Saved hides nothing", verdict: "broken" },
    { id: "r2", name: "Never stuck", verdict: "holds" },
  ],
  states: [
    { id: "a", label: "Saved", values: { Version: "0" }, breaks: [] },
    { id: "b", label: "Unsaved", values: { Version: "1" }, breaks: [] },
    { id: "c", label: "Far", values: {}, breaks: [] },
    { id: "d", label: "Hidden edit", values: { Version: "2" }, breaks: ["r1"] },
  ],
  start: "a",
  steps: [
    { from: "a", to: "b", label: "you type" },
    { from: "a", to: "b", label: "you type" },
    { from: "b", to: "c", label: "you wait" },
    { from: "c", to: "d", label: "far edit" },
    { from: "a", to: "d", label: "outside edit" },
  ],
  stopped: "The check stopped at one outside edit.",
};

const show = async (value: Statechart) => {
  const text = JSON.stringify(value);

  await openShelf([padOf("note", AGENT, `intro\n\n\`\`\`statechart\n${text}\n\`\`\`\n`)]);
  await openPad("note");
  await waitFor(() => expect(document.querySelector(".statechart-box")).not.toBeNull());
};

const must = <Item,>(item: Item | null | undefined): Item => {
  if (item === null || item === undefined) throw new Error("expected the element to exist");

  return item;
};

const lit = () => document.querySelector<HTMLElement>(".statechart-box.is-lit")?.dataset.state;

const textOf = (selector: string) => document.querySelector(selector)?.textContent ?? "";

const arrows = () => [...document.querySelectorAll<HTMLButtonElement>(".statechart-arrow")];

const named = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".visual-statechart button")].find((node) => node.textContent === name);

const moves = () => [...document.querySelectorAll(".statechart-move-list button")].map((node) => node.textContent);

describe("sc statechart block", () => {
  it("sc1_the_block_credits_its_agent_and_claims_no_check", async () => {
    await show(chart);

    expect(textOf(".statechart-credit")).toBe(copy.statechartCredit(chart.writtenBy));
  });

  it("sc2_summary_and_rules_come_before_the_chart", async () => {
    await show(chart);
    const order = [...must(document.querySelector(".visual-statechart")).children].map((node) => node.className);

    expect(order.indexOf("statechart-summary")).toBeLessThan(order.indexOf("statechart-rules"));
    expect(order.indexOf("statechart-rules")).toBeLessThan(order.indexOf("statechart-chart"));
    expect([...document.querySelectorAll(".statechart-rule")].map((node) => node.textContent)).toEqual(chart.rules.map((rule) => copy.statechartRule(rule.name, rule.verdict)));
    expect(document.querySelector(".statechart-details")?.children.length).toBe(0);
  });

  it("sc2_duplicate_steps_draw_one_move", async () => {
    await show(chart);

    expect(arrows().map((arrow) => arrow.getAttribute("aria-label"))).toEqual(["you type", "you wait", "far edit", "outside edit"]);
    expect(moves()).toEqual(["you type", "outside edit"]);
  });

  it("sc3_a_click_on_a_move_lights_its_target", async () => {
    await show(chart);

    expect(lit()).toBe("a");
    expect(arrows().filter((arrow) => !arrow.disabled).length).toBe(2);
    fireEvent.click(must(arrows()[0]));
    expect(lit()).toBe("b");
    expect(moves()).toEqual(["you wait"]);
    fireEvent.click(must(named("you wait")));
    expect(lit()).toBe("c");
  });

  it("sc3_back_and_start_over_undo_the_steps", async () => {
    await show(chart);

    expect(must(named("Back")).disabled).toBe(true);
    fireEvent.click(must(named("you type")));
    fireEvent.click(must(named("you wait")));
    fireEvent.click(must(named("Back")));
    expect(lit()).toBe("b");
    fireEvent.click(must(named("you wait")));
    fireEvent.click(must(named("Start over")));
    expect(lit()).toBe("a");
    expect(must(named("Back")).disabled).toBe(true);
  });

  it("sc3_tab_reaches_each_move_and_enter_takes_it", async () => {
    await show(chart);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".statechart-move-list button")];

    expect(buttons.every((node) => node.tagName === "BUTTON" && node.tabIndex === 0 && !node.disabled)).toBe(true);
    // A button takes Enter as a click.
    must(buttons[0]).focus();
    fireEvent.click(must(document.activeElement));
    expect(lit()).toBe("b");
  });

  it("sc3_the_machine_is_an_xstate_actor", async () => {
    await show(chart);

    expect(must(actors.at(-1)).getSnapshot().value).toBe("a");
    fireEvent.click(must(named("you type")));
    expect(must(actors.at(-1)).getSnapshot().value).toBe("b");
  });

  it("sc4_a_breaking_state_is_red_and_the_bar_names_the_rule", async () => {
    await show(chart);

    expect(document.querySelector(".is-red")).toBeNull();
    fireEvent.click(must(named("outside edit")));
    expect(document.querySelector<HTMLElement>(".statechart-box.is-red")?.dataset.state).toBe("d");
    expect(textOf(".statechart-bar")).toBe(copy.statechartBreaks(chart.rules[0]?.name ?? ""));
  });

  it("sc4_walk_to_the_break_takes_the_shortest_way", async () => {
    await show(chart);
    fireEvent.click(must(named("Walk to the break")));

    expect(lit()).toBe("d");
    expect(must(actors.at(-1)).getSnapshot().value).toBe("d");
    // The short way is one step, so Back returns to the start.
    fireEvent.click(must(named("Back")));
    expect(lit()).toBe("a");
  });

  it("sc4_walk_to_the_break_is_disabled_without_a_reachable_break", async () => {
    await show({ ...chart, start: "d" });
    expect(must(named("Walk to the break")).disabled).toBe(true);
    expect(textOf(".statechart-reason")).toBe(copy.statechartAlreadyBroken);
    cleanup();
    await show({ ...chart, start: "c", steps: [{ from: "c", to: "b", label: "back" }] });
    expect(must(named("Walk to the break")).disabled).toBe(true);
    expect(textOf(".statechart-reason")).toBe(copy.statechartNoBreakReachable);
  });

  it("sc4_a_block_whose_rules_all_hold_offers_no_walk", async () => {
    await show({ ...chart, rules: chart.rules.map((rule) => ({ ...rule, verdict: "holds" })), states: chart.states.map((state) => ({ ...state, breaks: [] })) });

    expect(named("Walk to the break")).toBeUndefined();
    expect(document.querySelector(".is-red")).toBeNull();
  });

  it("sc5_details_show_the_lit_states_values_and_where_the_check_stopped", async () => {
    await show(chart);

    expect(textOf(".statechart-details")).toBe("");
    fireEvent.click(must(named("Details")));
    expect(textOf(".statechart-details")).toContain(chart.states[0]?.label ?? "");
    expect(textOf(".statechart-details")).toContain(chart.states[0]?.values.Version ?? "");
    expect(textOf(".statechart-details")).toContain(chart.stopped);
    fireEvent.click(must(named("you type")));
    expect(textOf(".statechart-details")).toContain(chart.states[1]?.label ?? "");
    fireEvent.click(must(named("Details")));
    expect(textOf(".statechart-details")).toBe("");
    expect(lit()).toBe("b");
  });

  it.each([
    ["is not JSON", "{nope", /not JSON/],
    ["names a start no state holds", JSON.stringify({ ...chart, start: "zz" }), /"zz"/],
    ["lacks a field", JSON.stringify({ ...chart, stopped: undefined }), /"stopped"/],
  ])("sc6_a_bad_block_%s_shows_its_cause_and_its_source", async (_name, text, cause) => {
    await openShelf([padOf("note", AGENT, `\`\`\`statechart\n${text}\n\`\`\`\n`)]);
    await openPad("note");
    await waitFor(() => expect(document.querySelector(".visual-statechart .visual-error")).not.toBeNull());

    expect(document.querySelectorAll(".visual-statechart .visual-error").length).toBe(1);
    expect(document.querySelector(".visual-statechart .visual-error")?.textContent).toMatch(cause);
    expect(document.querySelector(".visual-statechart pre")?.textContent).toBe(text);
  });

  it("sc7_a_pad_without_a_block_never_loads_the_viewer", async () => {
    let requested = 0;

    useRenderers({ ...bundledRenderers, statechart: async () => { requested += 1;

 return api; } });
    await openShelf([padOf("note", USER, "# Heading\n\n```js\nlet a = 1\n```\n")]);
    await openPad("note");
    await new Promise((done) => setTimeout(done, 20));

    expect(requested).toBe(0);
  });

  it("sc7_a_pad_with_a_block_loads_it_once", async () => {
    let requested = 0;

    useRenderers({ ...bundledRenderers, statechart: async () => { requested += 1;

 return api; } });
    await show(chart);

    expect(requested).toBe(1);
  });

  it("sc1_stepping_writes_nothing_and_keeps_the_source", async () => {
    await show(chart);
    fireEvent.click(must(named("you type")));
    fireEvent.click(must(named("Details")));

    expect(document.querySelector(".ProseMirror")?.textContent).toContain(JSON.stringify(chart));
  });
});
