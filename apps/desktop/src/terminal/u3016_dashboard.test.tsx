import { duration, percent, tokenFigure } from "./measurementFormat";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRailAndPane } from "./paneHarness";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("u3016f_dashboard_navigation_preserves_work_and_focus", async () => {
  const { connected, app } = await mountRailAndPane([workstream("home")]);
  connected.rail.select("home");
  const open = await screen.findByRole("button", { name: "Cost and time" });
  open.focus();
  fireEvent.click(open);
  const dashboard = await screen.findByRole("region", { name: "Cost and time" });
  const exit = within(dashboard).getByRole("button", { name: "Close" });
  expect(exit.textContent).toBe("");
  fireEvent.click(exit);
  await waitFor(() => expect(document.activeElement).toBe(open));
  fireEvent.click(open);
  fireEvent.keyDown(await screen.findByRole("region", { name: "Cost and time" }), { key: "Escape" });
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

import { measurementFixture as summary, pricedCost } from "../testing/measurementFixture";

const dashboard = async () => {
  const mounted = await connectFakeProject([workstream("home")]);
  mounted.app.handlers["project.measurementSummary"] = (params) => summary(params.home, params.category, "1", params.offset);
  const [home, setHome] = createSignal("home");
  const result = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Show when={home()} keyed>{(id) => <MeasurementDashboard home={id} name={id} back={() => {}} />}</Show></ConnectedProjectContext.Provider>);
  await screen.findByRole("heading", { name: "Agents · 1,005" });

  return { ...mounted, ...result, setHome };
};

import { Show } from "solid-js";

it("u3016e_category_choice_changes_the_rank", async () => {
  const { app } = await dashboard();
  const output = await screen.findByRole("tab", { name: "Output" });
  fireEvent.click(output);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "project.measurementSummary").at(-1)?.params).toMatchObject({ category: "output", offset: 0 }));
  await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")[1]?.textContent).toContain("b"));
  expect(output.getAttribute("aria-selected")).toBe("true");
});

it("u3016e_paging_and_navigation_keep_all_contributors", async () => {
  const { app } = await dashboard();
  const more = await screen.findByRole("button", { name: "Load more" });
  more.focus();
  let fail = true;
  app.handlers["project.measurementSummary"] = (params) => {
    if (params.offset === 20 && fail) throw new Error("Page unavailable");

    return summary(params.home, params.category, "1", params.offset);
  };

  fireEvent.click(more);
  await screen.findByText(/Page unavailable/, {}, { timeout: 3000 });
  expect(screen.getAllByRole("row")).toHaveLength(21);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(41));
  expect(new Set(screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("button")[0]!.textContent)).size).toBe(40);
  expect(more.isConnected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "b" }));
  await screen.findByText(/b was removed/);
  app.handlers["project.measurementSummary"] = (params) => summary(params.home, params.category, "2", params.offset);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(21));
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
  answer!(summary("home", "total", "99"));
  await waitFor(() => expect(screen.queryByText(/revision 99/)).toBeNull());
  expect(screen.getByRole("heading", { name: "other" })).toBeTruthy();
  app.handlers["project.measurementSummary"] = (params) => summary(params.home, params.category, "3");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe("3"));
  app.handlers["project.measurementSummary"] = () => { throw new Error("Later read failed"); };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "4" } }));
  await screen.findByText(/Later read failed/, {}, { timeout: 3000 });
  expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe("3");
  expect(document.querySelector('[data-tile="time"]')?.textContent).toContain("20s Agent time");
});

it("u3016d_observations_update_one_live_view", async () => {
  const { app, unmount } = await dashboard();
  vi.useFakeTimers();
  app.handlers["project.measurementSummary"] = (params) => ({ ...summary(params.home, params.category, "2"), time: { ...summary().time, active: true } });
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
  const open = await screen.findByRole("button", { name: copy.costAndTime });
  fireEvent.click(open);
  await screen.findByRole("heading", { name: "Agents · 1,005" });
  fireEvent.click(tab("second"));
  await screen.findByText("elsewhere", { selector: ".name" });
  fireEvent.click(tab("first"));
  await screen.findByRole("button", { name: copy.costAndTime });
  fireEvent.keyDown(window,{key:"/",code:"Slash",metaKey:true});
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: copy.askBarLabel })).value).toBe(text);
  expect(first.calls.filter((call) => /spawn|startDoor|prompt|ask.send/.test(call.method))).toEqual([]);
  const draft = app.of(path("first")).calls.filter((call) => call.method === "project.measurementSummary");

  for (const call of draft) expect(call.params).toMatchObject({ home: "home" });
  first.handlers["ask.send"] = () => { throw new RpcError(-32000,"Fixture refused submission"); };

  fireEvent.keyDown(screen.getByRole("textbox",{name:copy.askBarLabel}),{key:"Enter"});
  await waitFor(() => expect(first.calls.filter((call)=>call.method==="ask.send").at(-1)?.params).toMatchObject({text,workstream:"home"}));
});

const priced = (params: { home: string; category: Parameters<typeof summary>[1]; offset?: number }, active = false): MeasurementSummary => {
  const base = summary(params.home, params.category, "1", params.offset ?? 0);
  const known = (value: string) => ({ known: value, missing: 0 });

  return { ...base, tokens: { input: known("76000"), output: known("19000"), cache_read: known("1748000"), cache_write: known("57000"), total: known("1900000") }, cost: pricedCost(), time: { ...base.time, elapsed_ns: String(((9 * 60 + 49) * 60) * 1_000_000_000), summed_ns: String(((19 * 60 + 20) * 60) * 1_000_000_000), active } };
};

const limit = (used: number | null) => () => ({ used_percent: used, resets_at: used === null ? null : Date.UTC(2026, 9, 28, 16, 0), reason: used === null ? "Claude Code is signed out, so its weekly limit cannot be read." : null });

const calls = (app: { calls: { method: string }[] }, method: string) => app.calls.filter((call) => call.method === method).length;

it("u3016g_dashboard_reads_in_the_ordered_layout", async () => {
  const { app } = await dashboard();
  app.handlers["project.measurementSummary"] = (params) => priced(params);
  app.handlers["project.weeklyLimit"] = limit(63);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await screen.findByText("9h 49m elapsed");
  const root = screen.getByRole("region", { name: "Cost and time" });
  const order = ["tile=time", "tile=tokens", "tile=price"].map((tile) => root.querySelector(`[data-${tile.replace("=", '="')}"]`)!);
  const after = [".measurement-limit", '[aria-label="Where Agent time went"]', ".measurement-agents"].map((selector) => root.querySelector(selector)!);
  const sequence = [root.querySelector("header")!, ...order, ...after];
  sequence.forEach((node, i) => { if (i > 0) expect(sequence[i - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); });
  expect(root.querySelector(".measurement-agents")?.getAttribute("aria-label")).toBe("Agents · 1,005");
  expect(screen.getByRole("tab", { name: "Total" }).getAttribute("aria-selected")).toBe("true");
});

it("u3016g_time_tile_leads_with_elapsed_and_never_charts_the_sum", async () => {
  const { app } = await dashboard();
  app.handlers["project.measurementSummary"] = (params) => priced(params);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await screen.findByText("9h 49m elapsed");
  expect(screen.getByText("19h 20m Agent time · 2.0×")).toBeTruthy();
  expect(document.querySelector('[data-tile="time"] .measurement-bar, [data-tile="time"] [role="meter"]')).toBeNull();
});

it("u3016g_tokens_tile_names_the_largest_share_and_exposes_exact_counts", async () => {
  const { app } = await dashboard();
  app.handlers["project.measurementSummary"] = (params) => priced(params);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await screen.findByText("1.9M");
  expect(screen.getByText("cache read 92%")).toBeTruthy();
  const group = screen.getByRole("group", { name: "Token categories" });
  fireEvent.focus(group);
  expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain("Cache read 1,748,000");
  fireEvent.keyDown(group, { key: "ArrowLeft" });
  expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain("Output 19,000");
});

it("u3016g_list_price_sums_estimates_and_keeps_reported_cost_apart", async () => {
  const { app } = await dashboard();
  app.handlers["project.measurementSummary"] = (params) => priced(params);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await screen.findByText("≈ $1.40", { exact: false });
  expect(screen.getByText("not your bill")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Tab" });
  screen.getByRole("button", { name: "How the list price is made" }).focus();
  const tip = (await screen.findByRole("tooltip")).textContent!;
  expect(tip).toContain("Opus 5.5 $0.98");
  expect(tip).toContain("Sonnet 5.5 $0.42");
  expect(tip).toContain("reported figure $1.13");
  expect(tip).not.toContain("2.53");
  app.handlers["project.measurementSummary"] = (params) => ({ ...priced(params), cost: { reported: [], reference: [], unavailable: [] } });
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "3" } }));
  await waitFor(() => expect(document.querySelector('[data-tile="price"] .measurement-figure')?.textContent).toBe("—"));
  expect(screen.queryByText("not your bill")).toBeNull();
  expect(screen.queryByRole("button", { name: copy.measurementPriceDetail })).toBeNull();
  const reportedOnly = priced({ home: "home", category: "total" });
  reportedOnly.cost.reference = [];
  await publish(app, reportedOnly);
  expect(screen.queryByText("not your bill")).toBeNull();
  screen.getByRole("button", { name: copy.measurementPriceDetail }).focus();
  const reportedTip = await screen.findByRole("tooltip");
  expect(reportedTip.textContent).toContain("reported figure $1.13");
  expect(reportedTip.textContent).not.toContain("≈");
});

it("u3016g_time_categories_are_not_parts_of_elapsed", async () => {
  const { app } = await dashboard();
  const section = screen.getByRole("region", { name: "Where Agent time went" });
  const entries = () => within(section).queryAllByRole("term").map((node) => node.textContent);
  expect(entries()).toEqual(["Agent work 65%", "Tools 20%", "Waiting on you 10%", "Coordination 5%"]);
  expect(within(section).getAllByRole("definition").map((node) => node.textContent)).toEqual(["13s", "4s", "2s", "1s"]);
  const value = summary();
  value.time = { ...value.time, summed_ns: "556000000000", execution_ns: "1000000000", tools_ns: "0", human_ns: "1000000000", coordination_ns: "0", other_ns: "554000000000" };
  await publish(app, value);
  expect(entries()).toEqual(["Other 99%", "Agent work <1%", "Waiting on you <1%"]);
  value.time = { ...value.time, summed_ns: "0", execution_ns: "0", human_ns: "0", other_ns: "0" };
  await publish(app, value);
  expect(entries()).toEqual([]);
  expect(section.querySelectorAll("p")).toHaveLength(1);
});

it("u3016g_agents_are_open_and_ranked_by_exact_values", async () => {
  const { app } = await dashboard();
  const names = () => screen.getAllByRole("row").slice(1, 3).map((row) => within(row).getAllByRole("button")[0]!.textContent);
  expect(names()).toEqual(["a", "b"]);
  expect(screen.getAllByRole("row")).toHaveLength(21);
  const big = (id: string, value: string) => ({ ...summary("home").rows[0]!, agent: id, maker: id, tokens: { ...summary("home").rows[0]!.tokens, total: { known: value, missing: 0 } } });
  app.handlers["project.measurementSummary"] = (params) => ({ ...summary(params.home, params.category, "2"), rows: [big("x", "1000001"), big("y", "1000002")].reverse() });
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await waitFor(() => expect(names()).toEqual(["y", "x"]));
  expect(screen.getAllByText("1,000,001").length).toBe(1);
});

it("u3016h_weekly_limit_is_the_accounts_figure_from_the_adapter_read", async () => {
  const { app } = await dashboard();
  vi.useFakeTimers();
  app.handlers["project.measurementSummary"] = (params) => priced(params, true);
  app.handlers["project.weeklyLimit"] = limit(63);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector(".measurement-limit-text")?.textContent).toBe("63% used · resets Wed 28 Oct 16:00");
  expect(app.calls.filter((call) => /spawn|prompt|startDoor/.test(call.method))).toEqual([]);
  app.handlers["project.weeklyLimit"] = limit(85);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(document.querySelector(".measurement-limit-text")?.textContent).toContain("85% used · near the limit");
  expect(document.querySelector(".measurement-limit")?.getAttribute("data-near")).toBe("true");
});

it("u3016h_unavailable_limit_is_dash_with_a_reason_and_reads_only_while_live", async () => {
  const { app } = await dashboard();
  vi.useFakeTimers();
  app.handlers["project.measurementSummary"] = (params) => priced(params, true);
  app.handlers["project.weeklyLimit"] = limit(null);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector(".measurement-limit-text")?.textContent).toBe("—");
  expect(screen.getByText(/signed out/)).toBeTruthy();
  const reads = () => calls(app, "project.weeklyLimit");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reads()).toBe(2);
  app.handlers["project.measurementSummary"] = (params) => priced(params, false);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "3" } }));
  await vi.advanceTimersByTimeAsync(0);
  const stopped = reads();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(reads()).toBe(stopped);
});

it("u3016i_view_is_live_only_while_work_runs", async () => {
  const { app } = await dashboard();
  vi.useFakeTimers();
  const reads = () => calls(app, "project.measurementSummary");
  app.handlers["project.measurementSummary"] = (params) => priced(params, true);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await vi.advanceTimersByTimeAsync(0);
  const before = reads();
  await vi.advanceTimersByTimeAsync(3000);
  expect(reads()).toBe(before + 3);
  app.handlers["project.measurementSummary"] = (params) => ({ ...priced(params, false), revision: "3", last_observed: new Date(2026, 9, 22, 9, 1, 36).getTime() });
  await vi.advanceTimersByTimeAsync(1000);
  const stopped = reads();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads()).toBe(stopped);
  expect(vi.getTimerCount()).toBe(0);
  expect(document.querySelector(".measurement-state")?.textContent).toBe("");
  app.handlers["project.measurementSummary"] = (params) => ({ ...priced(params, true), revision: "4" });
  app.emit(event({ name: "project.measurementsChanged", data: { revision: "4" } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
  const restarted = reads();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads()).toBe(restarted + 1);
});

it("u3016j_state_changes_never_add_or_remove_content_above_the_figures", async () => {
  const { app } = await dashboard();
  const regions = () => [...document.querySelector(".measurement-dashboard")!.children].map((node) => node.className || node.tagName);
  const initial = regions();
  const tiles = () => document.querySelector(".measurement-tiles")!.textContent;
  const text = tiles();
  app.handlers["project.measurementSummary"] = () => { throw new Error("Read unavailable"); };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
  await screen.findByText(/Read unavailable/, {}, { timeout: 3000 });
  expect(regions()).toEqual(initial);
  expect(tiles()).toBe(text);
  expect(screen.getByRole("button", { name: "Retry" }).closest("header")).toBeTruthy();
  app.handlers["project.measurementSummary"] = (params) => summary(params.home, params.category, "5");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText(/Read unavailable/)).toBeNull());
  expect(regions()).toEqual(initial);
});

it("u3016j_one_failed_read_then_success_shows_no_message", async () => {
  const { app } = await dashboard();
  let failed = false;
  app.handlers["project.measurementSummary"] = (params) => {
    if (!failed) { failed = true; throw new Error("Read unavailable"); }

    return summary(params.home, params.category, "6");
  };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "6" } }));
  await waitFor(() => expect(failed).toBe(true));
  await waitFor(() => expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe("6"), { timeout: 3000 });
  expect(screen.queryByText(/Read unavailable/)).toBeNull();
  expect(screen.queryByText(/unavailable\./)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("u3016g_numbers_use_display_units_and_never_show_unavailable_as_zero", () => {
  const tokens = (known: string) => tokenFigure({ known, missing: 0 });
  const seconds = (value: number) => duration(String(value * 1_000_000_000));

  expect(["0", "1", "9999", "10000", "1949999"].map(tokens)).toEqual(["0", "1", "9999", "10K", "1.9M"]);
  expect([seconds(59), seconds(3599), duration("0"), duration(null)]).toEqual(["59s", "59m 59s", "0s", copy.measurementUnknown]);
  expect([percent(0.4, 100), percent(1, 0), percent(0, 100)]).toEqual(["<1%", copy.measurementUnknown, "0%"]);
});

it("u3016k_unknown_zero_and_inert_marks_are_absent", async () => {
  const { app } = await dashboard();
  let revision = 1;

  for (const [known, missing] of [["0", 1], ["0", 0], ["20", 1]] as const) {
    const value = summary();
    value.revision = String(++revision);
    value.contributors = 1;
    value.rows = value.rows.slice(0, 1);
    value.next_offset = null;

    for (const key of ["total", ...copy.measurementParts] as const) {
      value.tokens[key] = { known, missing };
      value.rows[0]!.tokens[key] = { known, missing };
    }

    value.time = { ...value.time, summed_ns: "0", execution_ns: "0", tools_ns: "0", human_ns: "0", coordination_ns: "0", other_ns: "0", unmeasured_ns: "0" };
    app.handlers["project.measurementSummary"] = () => value;
    app.emit(event({ name: "project.measurementsChanged", data: { revision: value.revision } }));
    await waitFor(() => expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe(value.revision));
    expect(screen.queryByRole("button", { name: /How this is measured/ })).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.querySelectorAll(".measurement-legend li")).toHaveLength(known === "0" ? 0 : 4);
    expect(within(screen.getByRole("region", { name: copy.measurementTimeSpent })).queryAllByRole("term")).toHaveLength(0);
    const tile = document.querySelector<HTMLElement>('[data-tile="tokens"]')!;
    expect(tile.querySelector(".measurement-figure")?.textContent).toBe((known === "0" && missing > 0 ? "—" : known) + (missing > 0 ? "*" : ""));
    expect(within(tile).queryAllByRole("group")).toHaveLength(known === "0" ? 0 : 1);
    expect(within(tile).queryByRole("button", { name: copy.measurementPartial }) !== null).toBe(missing > 0);
  }
});

const publish = async (app: Awaited<ReturnType<typeof dashboard>>["app"], value: MeasurementSummary) => {
  value.revision = String(BigInt(document.querySelector(".measurement-dashboard")!.getAttribute("data-revision")!) + 1n);
  app.handlers["project.measurementSummary"] = () => structuredClone(value);
  app.emit(event({ name: "project.measurementsChanged", data: { revision: value.revision } }));
  await waitFor(() => expect(document.querySelector(".measurement-dashboard")?.getAttribute("data-revision")).toBe(value.revision));
};

it("u3016k_token_columns_require_known_nonzero_contributions", async () => {
  const { app } = await dashboard();
  const value = summary();
  value.rows = value.rows.slice(0, 1);
  value.next_offset = null;
  const unknown = { known: "0", missing: 1 };

  for (const key of ["total", ...copy.measurementParts] as const) value.rows[0]!.tokens[key] = { ...unknown };
  await publish(app, value);
  expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual(["Agent"]);
  expect(screen.queryAllByRole("cell")).toHaveLength(0);
  value.rows[0]!.tokens.input = { known: "10", missing: 0 };
  const zero = structuredClone(value.rows[0]!);
  zero.agent = "zero"; zero.maker = "zero"; zero.tokens.input = { known: "0", missing: 0 };
  const missing = structuredClone(zero);
  missing.agent = "unknown"; missing.maker = "unknown"; missing.tokens.input = unknown;
  value.rows.push(zero, missing);
  await publish(app, value);
  expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual(["Agent", "Input"]);
  expect(screen.getAllByRole("cell").map((node) => node.textContent)).toEqual(["10", "0", "—*"]);
  expect(screen.queryByRole("button", { name: /Measurement details/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
});

it("u3016k_controls_require_a_visible_effect", async () => {
  const { app } = await dashboard();
  const value = summary();
  value.rows = value.rows.slice(0, 2);
  value.rows[1]!.tokens = structuredClone(value.rows[0]!.tokens);
  value.next_offset = null;
  await publish(app, value);
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: copy.measurementLoadMore })).toBeNull();
  value.rows.forEach((row, index) => {
    for (const key of ["total", ...copy.measurementParts] as const) row.tokens[key] = { known: key === "total" ? String((index + 1) * 20) : key === "input" || key === "output" ? String((index + 1) * 10) : "0", missing: 0 };
  });
  await publish(app, value);
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  value.rows = value.rows.slice(0, 1);
  value.tokens = { ...value.tokens, total: { known: "800", missing: 0 }, input: { known: "800", missing: 0 }, output: { known: "0", missing: 0 }, cache_read: { known: "0", missing: 0 }, cache_write: { known: "0", missing: 0 } };
  await publish(app, value);
  expect(screen.getByRole("group", { name: copy.measurementShares }).hasAttribute("tabindex")).toBe(false);
  expect(document.querySelector('[aria-live="polite"]')).toBeNull();
  value.tokens.total.known = "80000"; value.tokens.input.known = "80000";
  await publish(app, value);
  const group = screen.getByRole("group", { name: copy.measurementShares });
  fireEvent.focus(group);
  expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("Input 80,000 · 100%");
  fireEvent.keyDown(group, { key: "ArrowRight" });
  expect(document.querySelector('[aria-live="polite"]')?.textContent).not.toContain("Output");
});

it("u3016k_empty_sections_have_one_message_and_no_placeholder_rows", async () => {
  const { app } = await dashboard();
  const value = summary();
  value.rows = []; value.contributors = 0; value.next_offset = null;
  value.cost = { reported: [], reference: [], unavailable: [] };

  for (const key of ["total", ...copy.measurementParts] as const) value.tokens[key] = { known: "0", missing: 0 };
  value.time = { ...value.time, elapsed_ns: "0", summed_ns: "0", execution_ns: "0", tools_ns: "0", human_ns: "0", coordination_ns: "0", other_ns: "0", unmeasured_ns: "0" };

  for (const missing of [0, 1]) {
    value.tokens.total.missing = missing;
    await publish(app, value);
    const time = screen.getByRole("region", { name: copy.measurementTimeSpent });
    const agents = screen.getByRole("region", { name: copy.measurementAgents(0) });
    expect(time.querySelectorAll("p")).toHaveLength(1);
    expect(agents.querySelectorAll("p")).toHaveLength(1);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(document.querySelector('[data-tile="time"] .measurement-line')).toBeNull();
    expect(document.querySelectorAll(".measurement-bar, .measurement-stack, .measurement-legend")).toHaveLength(0);
  }

  value.time = { ...value.time, elapsed_ns: "1000000000", summed_ns: "1000000", unmeasured_ns: "1000000", active: true };
  app.handlers["project.weeklyLimit"] = limit(0);
  await publish(app, value);
  await waitFor(() => expect(document.querySelector(".measurement-limit-text")?.textContent).toContain("0% used"));
  expect(screen.queryByRole("meter")).toBeNull();
  expect(document.querySelector('[data-tile="time"] .measurement-line')?.textContent).toContain("<1s");
  expect(document.querySelector('[data-tile="time"] .measurement-line')?.textContent).not.toContain("0.0×");
});

it("u3016k_equal_measurements_keep_visible_content", async () => {
  const { app } = await dashboard();
  const root = screen.getByRole("region", { name: copy.costAndTime });
  const before = root.textContent;
  const value = summary(); value.last_observed = 999999999;
  await publish(app, value);
  expect(root.textContent).toBe(before);
});

it("u3016k_partial_figures_keep_their_own_notes_and_price_basis", async () => {
  const { app } = await dashboard();
  const value = priced({ home: "home", category: "total" });
  value.tokens.total.missing = 2;
  value.coverage = ["Two contributors lack output counts"];
  value.time.coverage = ["Attempt end unknown"];
  await publish(app, value);
  const tokens = document.querySelector<HTMLElement>('[data-tile="tokens"]')!;
  within(tokens).getByRole("button", { name: copy.measurementPartial }).focus();
  expect((await screen.findByRole("tooltip")).textContent).toContain("Two contributors lack output counts");

  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.keyDown(document, { key: "Tab" });
  const time = document.querySelector<HTMLElement>('[data-tile="time"]')!;
  within(time).getByRole("button", { name: copy.measurementPartial }).focus();
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toContain("Attempt end unknown"));

  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.keyDown(document, { key: "Tab" });
  screen.getByRole("button", { name: copy.measurementPriceDetail }).focus();
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toContain("list rates fixture"));
  expect(screen.getByRole("tooltip").textContent).toContain("https://example.com/rates");
  expect(screen.getByRole("tooltip").textContent).toContain("reported figure $1.13");
  expect(screen.getByRole("tooltip").textContent).toContain("Opus 5.5 $0.98");
});
