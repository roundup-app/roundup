import { duration, percent } from "./measurementFormat";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRailAndPane } from "./paneHarness";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u3016f_dashboard_navigation_preserves_work_and_focus", async () => {
  const { connected, app } = await mountRailAndPane([workstream("home")]);
  connected.rail.select("home");
  const open = await screen.findByRole("button", { name: copy.measurementTime });
  open.focus();
  fireEvent.click(open);
  const dashboard = await screen.findByRole("region", { name: copy.measurementTime });
  const exit = within(dashboard).getByRole("button", { name: "Close" });
  expect(exit.textContent).toBe("");
  fireEvent.click(exit);
  await waitFor(() => expect(document.activeElement).toBe(open));
  fireEvent.click(open);
  fireEvent.keyDown(await screen.findByRole("region", { name: copy.measurementTime }), { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(open));
  expect(app.calls.filter((call) => /spawn|startDoor|prompt/.test(call.method))).toEqual([]);
});

import type { MeasurementSummary } from "@contracts/project/MeasurementSummary";
import { render, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import { ConnectedProjectContext } from "../state/connectedProject";
import { connectFakeProject } from "./paneHarness";
import { MeasurementDashboard } from "./MeasurementDashboard";
import { event } from "../testing/nodes";
import { measurementFixture as summary } from "../testing/measurementFixture";


const dashboard = async () => {
  const mounted = await connectFakeProject([workstream("home")]);
  mounted.app.handlers["project.measurementSummary"] = (params) => summary(params.home, "1", params.offset);
  const [home, setHome] = createSignal("home");
  const result = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Show when={home()} keyed>{(id) => <MeasurementDashboard home={id} name={id} back={() => {}} />}</Show></ConnectedProjectContext.Provider>);
  await screen.findByRole("button", { name: "Load more" });

  return { ...mounted, ...result, setHome };
};

import { Show } from "solid-js";

const rows = () => [...document.querySelectorAll<HTMLElement>(".measurement-rows > li")];

const names = () => rows().map((row) => row.querySelector("button")!.textContent);

const segments = (row: HTMLElement) => within(row).queryAllByRole("img").map((node) => node.getAttribute("aria-label"));

it("u3016e_paging_and_navigation_keep_all_contributors", async () => {
  const { app } = await dashboard();
  const more = await screen.findByRole("button", { name: "Load more" });
  more.focus();
  let fail = true;
  app.handlers["project.measurementSummary"] = (params) => {
    if (params.offset === 20 && fail) throw new Error("Page unavailable");

    return summary(params.home, "1", params.offset);
  };

  fireEvent.click(more);
  await screen.findByText(/Page unavailable/, {}, { timeout: 3000 });
  expect(rows()).toHaveLength(20);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(rows()).toHaveLength(40));
  expect(new Set(names()).size).toBe(40);
  expect(more.isConnected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "b" }));
  await screen.findByText(/b was removed/);
  app.handlers["project.measurementSummary"] = (params) => summary(params.home, "2", params.offset);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await waitFor(() => expect(rows()).toHaveLength(20));
  expect(document.activeElement).not.toBe(document.body);
});

it("u3016d_stale_reads_keep_original_identity_and_retry", async () => {
  const { app, setHome } = await dashboard();
  let answer: ((value: MeasurementSummary) => void) | undefined;
  app.handlers["project.measurementSummary"] = () => new Promise((resolve) => { answer = resolve; });
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await waitFor(() => expect(answer).toBeDefined());
  app.handlers["project.measurementSummary"] = () => { throw new Error("Read unavailable"); };

  setHome("other");
  await screen.findByText(/Read unavailable/, {}, { timeout: 3000 });
  answer!(summary("home", "99"));
  await waitFor(() => expect(screen.queryByText(/revision 99/)).toBeNull());
  expect(screen.getByRole("heading", { name: "other" })).toBeTruthy();
  app.handlers["project.measurementSummary"] = (params) => summary(params.home, "3");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe("3"));
  app.handlers["project.measurementSummary"] = () => { throw new Error("Later read failed"); };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "4" } }));
  await screen.findByText(/Later read failed/, {}, { timeout: 3000 });
  expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe("3");
  expect(document.querySelector(".measurement-line")?.textContent).toContain("28s Agent time");
});

it("u3016d_observations_update_one_live_view", async () => {
  const { app, unmount } = await dashboard();
  vi.useFakeTimers();
  app.handlers["project.measurementSummary"] = (params) => ({ ...summary(params.home, "2"), time: { ...summary().time, active: true } });
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await vi.advanceTimersByTimeAsync(0);
  const reads = () => app.calls.filter((call) => call.method === "project.measurementSummary").length;
  const before = reads();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads()).toBe(before + 1);
  const hidden=vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
  fireEvent(document,new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(reads()).toBe(before+1);
  hidden.mockReturnValue("visible");
  fireEvent(document,new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads()).toBe(before+2);
  hidden.mockRestore();
  const activeTimers = vi.getTimerCount();
  unmount();
  const after = reads();
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "3" } }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(reads()).toBe(after);
  expect(vi.getTimerCount()).toBeLessThan(activeTimers);
  vi.useRealTimers();
});

import { openTabs, path, tab } from "../header/stripFixture";
import { copy } from "../copy";
import { RpcError } from "../app/seam";

it("u3016f_exact_draft_and_recipient_survive_dashboard_and_project_navigation", async () => {
  const { app } = await openTabs({ first: [workstream("home")], second: [workstream("elsewhere")] });
  fireEvent.click(tab("first"));
  await screen.findByText("home", { selector: ".name" });
  const first = app.of(path("first"));
  first.handlers["project.measurementSummary"] = (params) => summary(params.home);
  fireEvent.click(document.querySelector('.rail [data-id="home"] [data-part="branch-control"]')!);
  await waitFor(() => expect(document.querySelector('[role="treeitem"][data-id="home"]')?.getAttribute("aria-selected")).toBe("true"));
  fireEvent.keyDown(window,{key:"/",code:"Slash",metaKey:true});
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: copy.askBarLabel });
  const text = "@home exact\ne\u0301 😀 \t ";
  fireEvent.input(field, { target: { value: text } });
  expect(field.value).toBe(text);
  fireEvent.keyDown(field,{key:"Escape"});
  const open = await screen.findByRole("button", { name: copy.measurementTime });
  fireEvent.click(open);
  await screen.findByRole("button", { name: "Load more" });
  fireEvent.click(tab("second"));
  await screen.findByText("elsewhere", { selector: ".name" });
  fireEvent.click(tab("first"));
  await screen.findByRole("button", { name: copy.measurementTime });
  fireEvent.keyDown(window,{key:"/",code:"Slash",metaKey:true});
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: copy.askBarLabel })).value).toBe(text);
  expect(first.calls.filter((call) => /spawn|startDoor|prompt|ask.send/.test(call.method))).toEqual([]);
  const draft = app.of(path("first")).calls.filter((call) => call.method === "project.measurementSummary");

  for (const call of draft) expect(call.params).toMatchObject({ home: "home" });
  first.handlers["ask.send"] = () => { throw new RpcError(-32000,"Fixture refused submission"); };

  fireEvent.keyDown(screen.getByRole("textbox",{name:copy.askBarLabel}),{key:"Enter"});
  await waitFor(() => expect(first.calls.filter((call)=>call.method==="ask.send").at(-1)?.params).toMatchObject({text,workstream:"home"}));
});


const nanoseconds = (seconds: number) => String(seconds * 1_000_000_000);

const noCoverage: string[] = [];

const timed = (seconds: Record<string, number>, active = false) => {
  const get = (key: string) => nanoseconds(seconds[key] ?? 0);
  const summed = Object.values(seconds).reduce((sum, value) => sum + value, 0);

  return { elapsed_ns: nanoseconds((9 * 60 + 49) * 60), summed_ns: nanoseconds(summed), execution_ns: get("execution"), tools_ns: get("tools"), human_ns: get("human"), coordination_ns: get("coordination"), other_ns: get("other"), unmeasured_ns: get("unmeasured"), active, coverage: noCoverage };
};

const agent = (id: string, seconds: Record<string, number>, coverage: string[] = []) => ({ agent: id, maker: id, removed: false, time: { ...timed(seconds), coverage }, coverage: noCoverage });

/** A (6 m work, 4 m tools, 2 m waiting) and B (3 m work), as U3016g's example. */
const two = (revision = "1", active = false): MeasurementSummary => {
  const a = agent("A", { execution: 360, tools: 240, human: 120 });
  const b = agent("B", { execution: 180 });

  return { ...summary("home", revision), contributors: 2, next_offset: null, rows: [a, b], time: { ...timed({ execution: 540, tools: 240, human: 120 }, active) } };
};

const calls = (app: { calls: { method: string }[] }, method: string) => app.calls.filter((call) => call.method === method).length;

const publish = async (app: Awaited<ReturnType<typeof dashboard>>["app"], value: MeasurementSummary) => {
  value.revision = String(BigInt(document.querySelector(".measurement-dashboard")!.getAttribute("data-revision")!) + 1n);
  app.handlers["project.measurementSummary"] = () => structuredClone(value);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: value.revision } }));
  await waitFor(() => expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe(value.revision));
};

it("u3016g_dashboard_reads_in_the_ordered_layout", async () => {
  const { app } = await dashboard();
  await publish(app, two());
  const root = screen.getByRole("region", { name: copy.measurementTime });
  const key = root.querySelector<HTMLElement>(".measurement-key")!;
  const sequence = [root.querySelector("header")!, root.querySelector(".measurement-line")!, key, root.querySelector(".measurement-rows")!];
  sequence.forEach((node, i) => { if (i > 0) expect(sequence[i - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); });
  expect(within(root).getByRole("heading", { name: "home" })).toBeTruthy();
  expect(root.querySelector(".measurement-line")?.textContent).toContain("9h 49m elapsed");
  expect(root.querySelector(".measurement-line")?.textContent).toContain("15m Agent time");
  expect(within(key).getAllByRole("listitem")).toHaveLength(3);
  expect(within(root).queryAllByRole("tab")).toHaveLength(0);
  expect(within(root).queryAllByRole("table")).toHaveLength(0);
});

it("u3016g_a_summary_of_two_agents_renders_one_mark_per_nonzero_category_and_no_cost", async () => {
  const { app } = await dashboard();
  const value = two();
  value.rows.push(agent("C", { coordination: 10 }), agent("Z", { other: 0 }));
  await publish(app, value);
  const found = rows();
  const [a, b, c, z] = [found[0]!, found[1]!, found[2]!, found[3]!];
  expect(segments(a).map((name) => name!.split(", ")[1])).toEqual(["Waiting on you", "Tools", "Agent work"]);
  expect(segments(a)[2]).toBe("A, Agent work, 6m, 50%");
  expect(segments(b)).toEqual(["B, Agent work, 3m, 100%"]);
  expect(segments(c)).toEqual(["C, Coordination, 10s, 100%"]);
  expect(segments(z)).toEqual([]);
  expect(within(z).getByText("0s")).toBeTruthy();
  const root = screen.getByRole("region", { name: copy.measurementTime });
  expect(root.textContent).not.toMatch(/token|cost|price|limit|×/i);
  expect(within(root).queryAllByRole("meter")).toHaveLength(0);
});

it("u3016e_agents_rank_by_exact_summed_time", async () => {
  const { app } = await dashboard();
  const big = (id: string, ns: string, removed = false) => ({ ...agent(id, { execution: 1 }), removed, time: { ...timed({ execution: 1 }), summed_ns: ns, execution_ns: ns } });
  const value = { ...two(), rows: [big("y", "1000000002"), big("door", "1000000001", true), big("x", "1000000001"), big("w", "1000000001")], contributors: 4 };
  await publish(app, value);
  expect(names()).toEqual(["y", "door", "x", "w"]);
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /rank|sort/i })).toBeNull();
});

it("u3016i_view_is_live_only_while_work_runs", async () => {
  const { app } = await dashboard();
  vi.useFakeTimers();
  const reads = () => calls(app, "project.measurementSummary");
  app.handlers["project.measurementSummary"] = () => two("2", true);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await vi.advanceTimersByTimeAsync(0);
  const before = reads();
  await vi.advanceTimersByTimeAsync(3000);
  expect(reads()).toBe(before + 3);
  app.handlers["project.measurementSummary"] = () => ({ ...two("3", false), last_observed: new Date(2026, 9, 22, 9, 1, 36).getTime() });
  await vi.advanceTimersByTimeAsync(1000);
  const stopped = reads();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads()).toBe(stopped);
  expect(vi.getTimerCount()).toBe(0);
  expect(document.querySelector(".measurement-state")?.textContent).toBe("");
  app.handlers["project.measurementSummary"] = () => two("4", true);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "4" } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
  const restarted = reads();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads()).toBe(restarted + 1);
});

it("u3016j_state_changes_never_add_or_remove_content_above_the_chart", async () => {
  const { app } = await dashboard();
  const regions = () => [...document.querySelector(".measurement-dashboard")!.children].map((node) => node.className || node.tagName);
  const initial = regions();
  const line = () => document.querySelector(".measurement-line")!.textContent;
  const text = line();
  app.handlers["project.measurementSummary"] = () => { throw new Error("Read unavailable"); };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await screen.findByText(/Read unavailable/, {}, { timeout: 3000 });
  expect(regions()).toEqual(initial);
  expect(line()).toBe(text);
  expect(screen.getByRole("button", { name: "Retry" }).closest("header")).toBeTruthy();
  app.handlers["project.measurementSummary"] = (params) => summary(params.home, "5");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText(/Read unavailable/)).toBeNull());
  expect(regions()).toEqual(initial);
});

it("u3016j_one_failed_read_then_success_shows_no_message", async () => {
  const { app } = await dashboard();
  let failed = false;
  app.handlers["project.measurementSummary"] = (params) => {
    if (!failed) { failed = true; throw new Error("Read unavailable"); }

    return summary(params.home, "6");
  };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "6" } }));
  await waitFor(() => expect(failed).toBe(true));
  await waitFor(() => expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe("6"), { timeout: 3000 });
  expect(screen.queryByText(/Read unavailable/)).toBeNull();
  expect(screen.queryByText(/unavailable\./)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("u3016g_numbers_use_display_units_and_never_show_unavailable_as_zero", () => {
  const seconds = (value: number) => duration(String(value * 1_000_000_000));

  expect([seconds(59), seconds(3599), duration("0"), duration(null)]).toEqual(["59s", "59m 59s", "0s", copy.measurementUnknown]);
  expect([percent(0.4, 100), percent(1, 0), percent(0, 100)]).toEqual(["<1%", copy.measurementUnknown, "0%"]);
});

it("u3016k_unknown_zero_and_inert_marks_are_absent", async () => {
  const { app } = await dashboard();

  for (const coverage of [["History before the first start is not measured"], []]) {
    const value = two();
    value.rows = [agent("A", {}, coverage)];
    value.contributors = 1;
    value.time = timed({});
    await publish(app, value);
    expect(screen.queryByRole("button", { name: /How this is measured/ })).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.querySelectorAll(".measurement-key li")).toHaveLength(0);
    expect(rows()).toHaveLength(0);
    expect(screen.getByText(copy.measurementEmpty)).toBeTruthy();
  }
});

it("u3016k_controls_require_a_visible_effect", async () => {
  const { app } = await dashboard();
  await publish(app, two());
  expect(screen.queryByRole("button", { name: copy.measurementLoadMore })).toBeNull();
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: copy.measurementPartial })).toBeNull();
  const value = two();
  value.next_offset = 2;
  await publish(app, value);
  expect(screen.getByRole("button", { name: copy.measurementLoadMore })).toBeTruthy();
});

it("u3016k_empty_sections_have_one_message_and_no_placeholder_rows", async () => {
  const { app } = await dashboard();
  const value = two();
  value.rows = []; value.contributors = 0; value.next_offset = null;
  value.time = { ...timed({}), elapsed_ns: "0" };
  await publish(app, value);
  expect(document.querySelectorAll(".measurement-chart p")).toHaveLength(1);
  expect(document.querySelectorAll(".measurement-key, .measurement-rows, .measurement-segment")).toHaveLength(0);
  expect(screen.queryByRole("meter")).toBeNull();
  value.time = { ...value.time, elapsed_ns: "1000000000", summed_ns: "1000000", unmeasured_ns: "1000000", active: true };
  value.rows = [{ ...agent("A", {}), time: { ...value.time } }];
  await publish(app, value);
  expect(document.querySelector(".measurement-line")?.textContent).toContain("<1s");
});

it("u3016k_equal_measurements_keep_visible_content", async () => {
  const { app } = await dashboard();
  const root = screen.getByRole("region", { name: copy.measurementTime });
  const before = root.textContent;
  const value = summary(); value.last_observed = 999999999;
  await publish(app, value);
  expect(root.textContent).toBe(before);
});

it("u3016k_partial_figures_keep_their_own_notes", async () => {
  const { app } = await dashboard();
  const value = two();
  value.time.coverage = ["Attempt end unknown"];
  value.rows[1] = agent("B", { execution: 180 }, ["Agent history not measured"]);
  await publish(app, value);
  const line = document.querySelector<HTMLElement>(".measurement-line")!;
  within(line).getByRole("button", { name: copy.measurementPartial }).focus();
  expect((await screen.findByRole("tooltip")).textContent).toContain("Attempt end unknown");

  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.keyDown(document, { key: "Tab" });
  within(rows()[1]!).getByRole("button", { name: copy.measurementPartial }).focus();
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toContain("Agent history not measured"));
  expect(within(rows()[0]!).queryByRole("button", { name: copy.measurementPartial })).toBeNull();
});

it("p3557c_failure_lifetime_measurement_dashboard", async () => {
  const { app } = await dashboard();

  app.handlers["project.measurementSummary"] = () => { throw new Error("Read unavailable"); };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "5" } }));
  await screen.findByText(/Read unavailable/, {}, { timeout: 3000 });

  // an unrelated item's removal is not this read's recovery
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(app.calls.some((call) => call.method === "rail.tree")).toBe(true));
  expect(screen.getByText(/Read unavailable/)).toBeTruthy();

  app.handlers["project.measurementSummary"] = (params) => summary(params.home, params.category, "7");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText(/Read unavailable/)).toBeNull());
});
