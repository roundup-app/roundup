import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { Account } from "@contracts/agent/Account";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Readback } from "@contracts/agent/Readback";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges } from "./noteHarness";
import {
  calls,
  comparison,
  counted,
  fresh,
  moduleRow,
  pane,
  press,
  setUpView,
  text,
} from "./viewHarness";

setUpView();

// U7703: the diagram's stepper over a fake Daemon that answers `agent.readback`, `agent.readbackStart` and nothing else about the readback.

const FILES = ["pkg/src/new.ts"].map((path) => counted(path, 17, 17));

const read = (path: string): FileComparison =>
  comparison(path, { old: text("old", "a\n"), new: text("new", "b\n") });

const STOPS = [
  { part: "run", text: "The run starts." },
  { part: "cache", text: "The cache is checked." },
  { part: "load", text: "The loader answers." },
];

const account = (over: Partial<Account> = {}): Account => ({
  overview: "Adds a loader.",
  diagram: "Before\nrun -> load\nAfter\nrun -> cache -> load",
  flows: [],
  modules: [{ module: "pkg", account: "Loads data." }],
  unplaced: [],
  ranks: [],
  risks: [],
  explanations: [],
  stops: STOPS,
  gaps: [],
  ...over,
});

const result = (
  state: "read" | "stale",
  over: Partial<Account> = {},
): Readback => ({ state, ...account(over) });

type Answering = { state: Readback };

const treeOpen = async (answer: Answering) => {
  const mounted = await mountControl(() => ({ files: FILES }), fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => read(path);
  mounted.app.handlers["agent.readback"] = () => answer.state;
  mounted.app.handlers["agent.readbackStart"] = () => {
    answer.state = { state: "reading" };

    return answer.state;
  };

  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));

  return mounted;
};

const group = () => screen.findByRole("group", { name: copy.stepDiagram });

const count = async () =>
  within(await group()).getByRole("status").textContent ?? "";

const lit = () =>
  [...pane().querySelectorAll(".readback-words li[aria-current]")].map(
    (row) => row.textContent ?? "",
  );

const next = async () =>
  fireEvent.click(
    within(await group()).getByRole("button", { name: copy.nextStop }),
  );

const previous = async () =>
  fireEvent.click(
    within(await group()).getByRole("button", { name: copy.previousStop }),
  );

const figure = () => pane().querySelector<HTMLElement>(".readback-diagram");

const asked = (app: { calls: { method: string }[] }) =>
  calls(app, "agent.readbackStart") + calls(app, "agent.explain");

it("u7703a_a_result_with_stops_draws_the_stepper_and_one_without_draws_none", async () => {
  const { app } = await treeOpen({ state: result("read") });

  expect(await count()).toContain(copy.stopCount(1, 3));
  expect(await count()).toContain(STOPS[0]?.text);
  expect(asked(app)).toBe(0);
});

it("u7703a_stops_that_name_no_drawn_part_are_dropped_and_none_left_draws_none", async () => {
  await treeOpen({
    state: result("read", {
      stops: [{ part: "elsewhere", text: "Not drawn." }, ...STOPS.slice(1)],
    }),
  });
  expect(await count()).toContain(copy.stopCount(1, 2));
});

it("u7703a_a_result_with_no_drawn_stop_has_no_stepper", async () => {
  await treeOpen({
    state: result("read", {
      stops: [{ part: "elsewhere", text: "Not drawn." }],
    }),
  });
  await screen.findByText(account().overview);
  expect(screen.queryByRole("group", { name: copy.stepDiagram })).toBeNull();
  expect(figure()?.getAttribute("tabindex")).toBeNull();
});

it("u7703b_next_and_previous_move_the_lit_part_and_the_sentence_and_call_nothing", async () => {
  const { app } = await treeOpen({ state: result("read") });

  await count();
  const rows = (part: string) => lit().filter((row) => row.includes(part));

  expect(lit().every((row) => row.includes("run"))).toBe(true);
  expect(lit()).toHaveLength(2);
  await next();
  expect(await count()).toContain(copy.stopCount(2, 3));
  expect(await count()).toContain(STOPS[1]?.text);
  expect(lit()).toHaveLength(2);
  expect(rows("cache")).toHaveLength(2);
  await next();
  expect(await count()).toContain(copy.stopCount(3, 3));
  expect(lit().every((row) => row.includes("load"))).toBe(true);
  expect(new Set([...pane().querySelectorAll('.readback-words li[aria-current]')].map((row) => row.closest('.readback-panel'))).size).toBe(2);

  const end = within(await group()).getByRole("button", {
    name: copy.nextStop,
  });

  expect(end.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(end);
  expect(await count()).toContain(copy.stopCount(3, 3));
  await previous();
  await previous();
  expect(
    within(await group())
      .getByRole("button", { name: copy.previousStop })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  await previous();
  expect(await count()).toContain(copy.stopCount(1, 3));
  expect(asked(app)).toBe(0);
  expect(
    within(await group()).getByRole("button", { name: copy.nextStop })
      .textContent,
  ).toBe("");
});

it("u7703c_the_arrow_keys_step_a_focused_diagram_only", async () => {
  await treeOpen({ state: result("read") });
  await count();

  // Focus elsewhere: a list row and the Overview's own text step nothing.
  press("ArrowRight", moduleRow("pkg"));
  press("ArrowRight", pane());
  expect(await count()).toContain(copy.stopCount(1, 3));

  const diagram = figure();

  if (!diagram) throw new Error("no diagram");
  diagram.focus();
  press("ArrowRight", diagram);
  expect(await count()).toContain(copy.stopCount(2, 3));
  press("ArrowLeft", diagram);
  expect(await count()).toContain(copy.stopCount(1, 3));

  press("?");
  const keys = await screen.findByRole("region", { name: copy.keys });

  expect(
    within(keys)
      .getAllByRole("listitem")
      .filter((item) => /diagram/.test(item.textContent ?? "")),
  ).toHaveLength(2);
});

it("u7703d_a_stale_result_dims_its_stepper_and_a_new_run_starts_at_the_first_stop", async () => {
  const answer: Answering = { state: result("stale") };

  await treeOpen(answer);
  await count();
  await next();
  expect(await count()).toContain(copy.stopCount(2, 3));
  expect(
    pane().querySelector(".readback-account")?.getAttribute("data-stale"),
  ).toBe("true");
  expect(
    await screen.findByText(copy.changedSinceReadback, { exact: false }),
  ).toBeTruthy();
  await next();
  expect(await count()).toContain(copy.stopCount(3, 3));

  press("r");
  await screen.findByText(copy.readingBack);
  answer.state = result("read");
  await waitFor(
    () =>
      expect(
        pane().querySelector(".readback-account")?.getAttribute("data-stale"),
      ).toBe("false"),
    { timeout: 3000 },
  );
  expect(await count()).toContain(copy.stopCount(1, 3));
});
