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
  fireEvent.keyDown(dashboard, { key: "Escape" });
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

import { measurementFixture as summary } from "./measurementFixture";

const dashboard = async () => {
  const mounted = await connectFakeProject([workstream("home")]);
  mounted.app.handlers["project.measurementSummary"] = (params) => summary(params.home, params.category, "1", params.offset);
  const [home, setHome] = createSignal("home");
  const result = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Show when={home()} keyed>{(id) => <MeasurementDashboard home={id} name={id} back={() => {}} />}</Show></ConnectedProjectContext.Provider>);
  await screen.findByRole("button", { name: "Contributors · 1,005" });

  return { ...mounted, ...result, setHome };
};

import { Show } from "solid-js";

it("u3016e_category_choice_changes_the_rank", async () => {
  const { app } = await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Contributors · 1,005" }));
  const output = await screen.findByRole("tab", { name: "Output" });
  fireEvent.click(output);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "project.measurementSummary").at(-1)?.params).toMatchObject({ category: "output", offset: 0 }));
  await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")[1]?.textContent).toContain("b"));
  expect(output.getAttribute("aria-selected")).toBe("true");
});

it("u3016e_paging_and_navigation_keep_all_contributors", async () => {
  const { app } = await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Contributors · 1,005" }));
  const more = await screen.findByRole("button", { name: "Load more" });
  more.focus();
  let fail = true;
  app.handlers["project.measurementSummary"] = (params) => {
    if (params.offset === 20 && fail) throw new Error("Page unavailable");

    return summary(params.home, params.category, "1", params.offset);
  };

  fireEvent.click(more);
  await screen.findByText(/Page unavailable/);
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
  await screen.findByText(/Read unavailable/);
  answer!(summary("home", "total", "99"));
  await waitFor(() => expect(screen.queryByText("Revision 99")).toBeNull());
  expect(screen.getByRole("heading", { name: "other" })).toBeTruthy();
  app.handlers["project.measurementSummary"] = (params) => summary(params.home, params.category, "3");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(/Revision 3/);
  app.handlers["project.measurementSummary"] = () => { throw new Error("Later read failed"); };

  app.emit(event({ name: "project.measurementsChanged", data: { revision: "4" } }));
  await screen.findByText(/Later read failed/);
  expect(screen.getByText(/Revision 3/)).toBeTruthy();
  expect(screen.getByText(/Last observed/)).toBeTruthy();
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
  await screen.findByRole("button", { name: "Contributors · 1,005" });
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
