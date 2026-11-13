import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, renderTabs, path, tab } from "../header/stripFixture";
import { agent, door, event, terminal, workstream } from "../testing/nodes";
import { unseenStorage } from "../state/unseen";
import { chooseAction, settled } from "../rail/railFixture";
import type { FakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

// U5959b: Ready keeps the last hour, so the Agents' fixed `since` values sit a minute before this clock.
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(60_000);
});

const actions = (app: FakeApp) => app.menuBar?.entries.flatMap(entry => entry.action?.kind === "agent" ? [entry.action] : []) ?? [];

const finish = (app: FakeApp, project: string, id: string) => app.of(path(project)).emit(event({ name: "agent.status", data: {
  id, attempt: "1", status_revision: "2", status: { kind: "idle", label: "settled", since: 10, finished: "1" },
} }));

it("u5502_waiting_wins_without_duplicating_an_agent", async () => {
  const { app } = await openTabs({ api: [agent("waiting", "needs-you", "question"), agent("ready", "working", "running")], web: [agent("other", "working", "running")] });
  app.of(path("api")).emit(event({ name: "agent.status", data: { id: "waiting", attempt: "1", status_revision: "2", status: { kind: "needs-you", label: "question", since: 10, finished: "1" } } }));
  finish(app, "api", "ready");

  await waitFor(() => expect(actions(app)).toEqual([
    { kind: "agent", path: path("api"), agent: "waiting" },
    { kind: "agent", path: path("api"), agent: "ready" },
  ]));
  expect(app.menuBar?.mark).toBe("waiting");
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "waiting" });
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  expect(actions(app).filter(action => action.agent === "waiting")).toHaveLength(1);
});

it("u5502_projects_and_doors_keep_distinct_identities", async () => {
  const { app } = await openTabs({ api: [door("same", "needs-you", "question"), workstream("aggregate")], web: [agent("same", "error", "failure")] });

  await waitFor(() => expect(actions(app)).toEqual([
    { kind: "agent", path: path("api"), agent: "same" },
    { kind: "agent", path: path("web"), agent: "same" },
  ]));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "same" });
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  expect(document.querySelector('[role=treeitem][data-id="same"]')?.getAttribute("aria-selected")).toBe("true");
});

it("u5502_gone_menu_row_shows_nothing_and_a_valid_one_selects", async () => {
  const { app } = await openTabs({ api: [agent("a", "needs-you", "question")], web: [] });

  app.menuBarAction({ kind: "agent", path: path("api"), agent: "gone" });
  await new Promise(resolve => setTimeout(resolve));
  expect(screen.queryByRole("alert")).toBeNull();

  app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="a"]')?.getAttribute("aria-selected")).toBe("true"));
});

it.each([false, true])("u5502_open_and_more_do_not_acknowledge_results (overflow=%s)", async overflow => {
  const { app } = await openTabs({ api: Array.from({ length: overflow ? 10 : 1 }, (_, index) => agent(String(index), "working", "running")) });
  await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="0"]')).not.toBeNull());
  fireEvent.click(document.querySelector<HTMLElement>('[role=treeitem][data-id="0"]')!);
  fireEvent.blur(window);

  for (let index = 0; index < (overflow ? 10 : 1); index++) finish(app, "api", String(index));
  await waitFor(() => expect(actions(app)).toHaveLength(overflow ? 7 : 1));
  const menu = app.menuBar;
  const commands = menu?.entries.flatMap(entry => entry.action?.kind === "open" ? [entry.action] : []) ?? [];
  expect(commands).toHaveLength(overflow ? 2 : 1);

  const show = vi.spyOn(app, "showWindow").mockImplementation(async () => { fireEvent.focus(window); });

  app.menuBarAction(commands[0]!);
  expect(show).toHaveBeenCalledOnce();
  await settled();
  expect(app.menuBar).toEqual(menu);
  expect(document.querySelector('[role=treeitem][data-id="0"]')?.getAttribute("aria-selected")).toBe("true");

  // A subsequent ordinary activation still acknowledges the displayed Agent.
  fireEvent.blur(window);
  fireEvent.focus(window);
  await waitFor(() => expect(actions(app).some(action => action.agent === "0")).toBe(false));
});

it.each([0, 7, 8, 10].flatMap(count => (count ? [true, false] : [true]).map(waiting => ({ count, waiting }))))("u5502_seven_rows_share_one_limit ($count, waiting=$waiting)", async ({ count, waiting }) => {
  const { app } = await openTabs({ api: Array.from({ length: count }, (_, index) => agent(String(index), waiting ? "needs-you" : "working", "live")) });

  if (!waiting) for (let index = 0; index < count; index++) finish(app, "api", String(index));
  await waitFor(() => expect(app.menuBar).not.toBeNull());
  await waitFor(() => expect(actions(app)).toHaveLength(Math.min(count, 7)));
  expect(app.menuBar?.entries.filter(entry => entry.action?.kind === "open")).toHaveLength(count > 7 ? 2 : 1);
});

it("u5502_later_results_rearm_without_replay", async () => {
  const { app } = await openTabs({ api: [agent("a", "idle", "resting"), agent("other", "idle", "resting")], web: [agent("b", "idle", "resting")] });
  const records: import("@contracts/deliverable/Deliverable").Deliverable[] = [];
  const daemon = app.of(path("api"));
  daemon.handlers["deliverable.list"] = () => [...records];

  const publish = (id: string) => {
    records.push({ project: "api-key", id, maker: { kind: "agent", id: "a", parent: null }, maker_name: "a", home: null, title: "Result", published_at: 100, target: { kind: "external", url: "https://example.com", availability: "not-checked" } });
    daemon.emit(event({ name: "deliverable.changed" }));
  };

  publish("first");
  await waitFor(() => expect(actions(app)).toEqual([{ kind: "agent", path: path("api"), agent: "a" }]));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(actions(app)).toHaveLength(0));
  fireEvent.click(tab("web"));
  const reads = daemon.calls.filter(call => call.method === "deliverable.list").length;
  daemon.emit(event({ name: "deliverable.changed" }));
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "deliverable.list").length).toBeGreaterThan(reads));
  expect(actions(app)).toHaveLength(0);
  publish("second");
  await waitFor(() => expect(actions(app)).toHaveLength(1));
});


it("u5502_reload_reconciles_ready_results", async () => {
  const trees = { api: [agent("a", "idle", "resting")], web: [agent("b", "idle", "resting")] };
  const publication = (id: string): import("@contracts/deliverable/Deliverable").Deliverable => ({ project: "api-key", id, maker: { kind: "agent", id: "a", parent: null }, maker_name: "a", home: null, title: "Published result", published_at: 100, target: { kind: "external", url: "https://example.com", availability: "not-checked" } });
  const records = [publication("history")];
  const first = renderTabs(trees);
  first.app.of(path("api")).handlers["deliverable.list"] = () => [...records];
  await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));
  await waitFor(() => expect(first.app.menuBar?.mark).toBe("empty"));
  records.push(publication("unread"));
  first.app.of(path("api")).emit(event({ name: "deliverable.changed" }));
  await waitFor(() => expect(actions(first.app)).toHaveLength(1));
  await unseenStorage(path("api")).refresh();
  cleanup();
  records.push(publication("gap"));
  const next = renderTabs(trees, true);
  next.app.of(path("api")).handlers["deliverable.list"] = () => [...records];
  await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));
  await waitFor(() => expect(actions(next.app)).toHaveLength(1));
  next.app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(actions(next.app)).toHaveLength(0));
  await unseenStorage(path("api")).refresh();
  cleanup();
  const read = renderTabs(trees, true);
  read.app.of(path("api")).handlers["deliverable.list"] = () => [...records];
  await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));
  await waitFor(() => expect(read.app.menuBar?.mark).toBe("empty"));
});


it.each([false, true])("u5502_reload_keeps_actual_finish_times (finish in reload gap=%s)", async (gap) => {
  const trees = { api: [agent("a", "working", "running"), agent("b", "working", "running")], web: [] };
  const first = await openTabs(trees);

  const statuses = [
    event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "idle", label: "settled", since: 100, finished: "1" } } }),
    event({ name: "agent.status", data: { id: "b", attempt: "1", status_revision: "2", status: { kind: "idle", label: "settled", since: 200, finished: "1" } } }),
    event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "3", status: { kind: "working", label: "running again", since: 300, finished: "1" } } }),
  ];

  if (!gap) {
    for (const status of statuses.slice(0, 2)) first.app.of(path("api")).emit(status);
    await waitFor(() => expect(actions(first.app).map(action => action.agent)).toEqual(["b", "a"]));
  }

  await unseenStorage(path("api")).refresh();
  cleanup();

  const next = renderTabs({ api: [
    agent("a", "working", "running again", { status: { kind: "working", label: "running again", since: 300, finished: "1" }, status_revision: "3" }),
    agent("b", "idle", "settled", { status: { kind: "idle", label: "settled", since: 200, finished: "1" }, status_revision: "2" }),
  ], web: [] }, true);

  const daemon = next.app.of(path("api"));
  const subscribe = daemon.subscribe;
  daemon.head = 3;
  daemon.subscribe = async (listener, after) => {
    const head = await subscribe(listener, after);

    statuses.forEach((status, index) => listener({ ...status, seq: index + 1 }));

    return head;
  };

  await waitFor(() => expect(next.app.menuBar?.entries.flatMap(entry => entry.action?.kind === "agent" ? [[entry.action.agent, entry.since]] : [])).toEqual([["b", 200], ["a", 100]]));
});


it("u5502_menu_groups_and_orders_agents", async () => {
  const { app } = await openTabs({ api: [
    agent("older", "needs-you", "question", { status: { kind: "needs-you", label: "question", since: 1, finished: "0" } }),
    agent("newer", "error", "failure", { status: { kind: "error", label: "failure", since: 2, finished: "0" } }),
  ], web: [agent("tie", "needs-you", "question", { status: { kind: "needs-you", label: "question", since: 1, finished: "0" } })] });

  await waitFor(() => expect(actions(app).map(action => action.agent)).toEqual(["older", "tie", "newer"]));
  app.of(path("api")).emit(event({ name: "agent.status", data: { id: "older", attempt: "1", status_revision: "2", status: { kind: "needs-you", label: "a later live line", since: 100, finished: "0" } } }));
  await waitFor(() => expect(app.menuBar?.entries.find(entry => entry.action?.kind === "agent" && entry.action.agent === "older")?.since).toBe(1));
  expect(actions(app).map(action => action.agent)).toEqual(["older", "tie", "newer"]);
});


it("u5502_opening_acknowledges_only_that_agents_results", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "running"), agent("other", "working", "running")], web: [agent("a", "working", "running")] });
  fireEvent.click(tab("api"));
  await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="other"]')).not.toBeNull());
  fireEvent.click(document.querySelector<HTMLElement>('[role=treeitem][data-id="other"]')!);
  fireEvent.click(tab("web"));
  const daemon = app.of(path("api"));
  daemon.handlers["deliverable.list"] = () => ["a", "other"].map(id => ({ project: "api-key", id: `published-${id}`, maker: { kind: "agent", id, parent: null }, maker_name: id, home: null, title: "Result", published_at: 20, target: { kind: "external", url: "https://example.com", availability: "not-checked" } }));
  daemon.emit(event({ name: "deliverable.changed" }));
  finish(app, "api", "a");
  finish(app, "api", "other");
  finish(app, "web", "a");
  await waitFor(() => expect(actions(app)).toHaveLength(3));
  await waitFor(() => expect(app.menuBar?.entries.filter(entry => entry.since === 20)).toHaveLength(2));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(actions(app)).toEqual([
    { kind: "agent", path: path("api"), agent: "other" },
    { kind: "agent", path: path("web"), agent: "a" },
  ]));
  fireEvent.click(document.querySelector<HTMLElement>('[role=treeitem][data-id="other"]')!);
  await waitFor(() => expect(actions(app)).toEqual([{ kind: "agent", path: path("web"), agent: "a" }]));
});

it("u5502_updates_raise_no_sound_alert_or_window_activation", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "running")], web: [agent("b", "idle", "resting")] });
  const alert = vi.spyOn(app, "stateAlert");
  const calls = app.calls.length;
  finish(app, "api", "a");
  await waitFor(() => expect(app.menuBar?.mark).toBe("ready"));
  expect(alert).not.toHaveBeenCalled();
  expect(tab("web").getAttribute("aria-selected")).toBe("true");
  expect(app.calls.slice(calls).filter(call => /prompt|spawn|start|stop|write|message.send|accept/.test(call.method))).toEqual([]);
});

it("u5502_membership_uses_finishes_publications_and_current_attention", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "running"), agent("historical", "done", "old"), terminal("shell"), workstream("aggregate")], web: [] });
  await waitFor(() => expect(app.menuBar?.mark).toBe("empty"));
  fireEvent.click(tab("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  const daemon = app.of(path("api"));
  daemon.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "2", status: { kind: "idle", label: "resting", since: 10, finished: "0" } } }));
  await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="a"]')?.getAttribute("data-kind")).toBe("idle"));
  expect(actions(app)).toHaveLength(0);
  daemon.handlers["deliverable.list"] = () => [{ project: "api-key", id: "publication", maker: { kind: "agent", id: "a", parent: null }, maker_name: "a", home: null, title: "Result", published_at: 100, target: { kind: "external", url: "https://example.com", availability: "not-checked" } }];
  daemon.emit(event({ name: "deliverable.changed" }));
  await waitFor(() => expect(actions(app)).toEqual([{ kind: "agent", path: path("api"), agent: "a" }]));
  expect(app.menuBar?.mark).toBe("ready");
});


it("u5502_quiet_exclusions_and_messages_do_not_light_the_mark", async () => {
  const { app } = await openTabs({ api: [agent("eligible", "needs-you", "question"), agent("excluded", "error", "failure"), agent("quiet-waiting", "needs-you", "question", { alert_level: "quiet" }), agent("quiet-ready", "working", "running", { alert_level: "quiet" })], web: [] });
  fireEvent.click(tab("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  finish(app, "api", "quiet-ready");
  await chooseAction(app, "excluded", "Dismiss error");
  await waitFor(() => expect(actions(app)).toEqual([{ kind: "agent", path: path("api"), agent: "eligible" }]));
  const menu = app.menuBar;
  const daemon = app.of(path("api"));
  daemon.emit(event({ name: "message.sent", data: { id: 1, from: { kind: "agent", id: "eligible", parent: null }, to: "excluded", kind: "note", body: "result", replyTo: null, status: "pending", reason: null, at: 20 } }));
  daemon.emit(event({ name: "route.changed", data: { from: "eligible", to: "excluded", delivery: "drop" } }));
  await settled();
  expect(app.menuBar).toEqual(menu);
  expect(app.stateAlerts).toEqual([]);
});


it("u5502_seven_rows_share_one_limit_across_both_groups", async () => {
  const { app } = await openTabs({ api: Array.from({ length: 10 }, (_, index) => agent(String(index), index < 4 ? "needs-you" : "working", "live")) });

  for (let index = 4; index < 10; index++) finish(app, "api", String(index));
  await waitFor(() => expect(actions(app).map(action => action.agent)).toEqual(["0", "1", "2", "3", "4", "5", "6"]));
  expect(app.menuBar?.entries.filter(entry => entry.action === null)).toHaveLength(2);
});

it("u5502_project_close_reopen_reconciles_its_own_publications", async () => {
  const { app } = await openTabs({ api: [agent("a", "idle", "resting")], web: [agent("a", "idle", "resting")] });

  for (const project of ["api", "web"]) {
    const daemon = app.of(path(project));
    daemon.handlers["deliverable.list"] = () => [{ project: `${project}-key`, id: "same-publication-id", maker: { kind: "agent", id: "a", parent: null }, maker_name: "a", home: null, title: "Result", published_at: 100, target: { kind: "external", url: "https://example.com", availability: "not-checked" } }];
    daemon.emit(event({ name: "deliverable.changed" }));
  }

  await waitFor(() => expect(actions(app)).toHaveLength(2));
  fireEvent.click(tab("api").closest(".project-tab")!.querySelector<HTMLElement>(".tab-close")!);
  await waitFor(() => expect(app.closed).toEqual([path("api")]));
  await waitFor(() => expect(actions(app)).toEqual([{ kind: "agent", path: path("web"), agent: "a" }]));
  app.nativeOpen({ kind: "project", path: path("api") });
  await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));
  await waitFor(() => expect(actions(app)).toHaveLength(2));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(actions(app)).toEqual([{ kind: "agent", path: path("web"), agent: "a" }]));
});


it.each(["app", "project"])("u5502_row_opens_the_original_agents_terminal_from_%s_settings", async settings => {
  const { app } = await openTabs({ api: [agent("a", "working", "running")], web: [] });
  fireEvent.click(tab("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));

  fireEvent.click(document.querySelector<HTMLElement>('[role=treeitem][data-id="a"]')!);

  if (settings === "app") window.dispatchEvent(new Event("open-app-settings"));
  else window.dispatchEvent(new CustomEvent("open-project-page", { detail: { path: path("api"), command: "project-settings" } }));
  const surface = await screen.findByRole("region", { name: settings === "app" ? "Settings" : "Project settings" });
  finish(app, "api", "a");
  await waitFor(() => expect(actions(app)).toHaveLength(1));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(surface.isConnected).toBe(false));
  expect(document.querySelector('[role=treeitem][data-id="a"]')?.getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(actions(app)).toHaveLength(0));
});

const finishNow = (app: FakeApp, round = 1) => app.of(path("api")).emit(event({ name: "agent.status", data: {
  id: "ready", attempt: "1", status_revision: String(round + 1), status: { kind: "idle", label: "settled", since: Date.now(), finished: String(round) },
} }));

it("u5970_ready_row_folds_when_the_hour_passes", async () => {
  const { app } = await openTabs({ api: [agent("ready", "working", "running")], web: [] });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(60_000);
  finishNow(app);
  await vi.advanceTimersByTimeAsync(0);
  expect(actions(app)).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(50 * 60_000);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(actions(app)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);

  const labelsOf = (entries: NonNullable<FakeApp["menuBar"]>["entries"]) => entries.map(entry => entry.label);
  expect(labelsOf(app.menuBar!.entries)).toEqual(["Nothing for you", "1 earlier…", "Open roundup"]);
  expect(labelsOf(app.menuBar!.dock)).toEqual(["Nothing for you", "1 earlier…", "Open roundup"]);
  expect(app.menuBar?.mark).toBe("ready");
});

it("u5970_the_next_cut_is_scheduled_not_polled", async () => {
  const { app } = await openTabs({ api: [agent("ready", "working", "running")], web: [] });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(60_000);
  expect(vi.getTimerCount()).toBe(0);
  finishNow(app);
  await vi.advanceTimersByTimeAsync(0);
  expect(actions(app)).toHaveLength(1);
  const timers = vi.getTimerCount();
  expect(timers).toBeGreaterThan(0);

  await vi.advanceTimersByTimeAsync(30 * 60_000);
  finishNow(app, 2);
  await vi.advanceTimersByTimeAsync(31 * 60_000);
  expect(actions(app)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect(actions(app)).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("u6994a_unchanged_presentation_sends_nothing", async () => {
  const { app } = await openTabs({ api: [agent("hidden", "working", "running"), agent("waiting", "needs-you", "question")] });
  await waitFor(() => expect(actions(app)).toHaveLength(1));
  let sent = 0;
  let latest = app.menuBar;
  Object.defineProperty(app, "menuBar", { get: () => latest, set: (menu: typeof latest) => { sent++; latest = menu; } });

  const status = (id: string, kind: "working" | "needs-you", label: string, revision: string) => app.of(path("api")).emit(event({ name: "agent.status", data: {
    id, attempt: "1", status_revision: revision, status: { kind, label, since: 60_000, finished: "0" },
  } }));

  status("hidden", "working", "reading", "2");
  status("hidden", "working", "writing", "3");
  await settled();
  expect(sent).toBe(0);

  status("waiting", "needs-you", "another question", "2");
  await waitFor(() => expect(sent).toBe(1));
});
