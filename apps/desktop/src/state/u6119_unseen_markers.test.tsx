import { cleanup, fireEvent, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent, door, event, workstream } from "../testing/nodes";
import { mountBubbles } from "../bubbles/bubblesFixture";
import { ConnectedProjectContext, connectProject } from "./connectedProject";
import { AskBar } from "../ask/AskBar";
import { ask } from "../ask/askFixture";
import { createFakeApp } from "../testing/fakeApp";
import { render } from "@solidjs/testing-library";
import { info } from "../testing/nodes";
import { tab } from "../header/stripFixture";
import { openTabs, path } from "../header/stripFixture";
import type { FakeApp } from "../testing/fakeApp";

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockImplementation(() => true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const row = (id: string) => document.querySelector<HTMLElement>(`[role=treeitem][data-id="${id}"]`)!;

const unread = (element: HTMLElement) => within(element).queryByRole("img", { name: "Unread result" }) !== null;

const status = (app: FakeApp, id: string, revision: number, kind: "idle" | "needs-you" | "error", finished: string) =>
  app.of(path("api")).emit(event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(revision), status: { kind, label: kind, since: revision, finished } } }));

const opened = (clock?: () => number) => openTabs({ api: [door("w", "working", "x"), agent("child", "working", "x", { parent: "w" }), agent("top", "working", "x"), agent("other", "working", "x")], observer: [] }, false, clock);

const fixture = async (clock?: () => number) => {
  const mounted = await opened(clock);

  fireEvent.click(tab("api"));
  await waitFor(() => expect(row("other")).not.toBeNull());

  return mounted;
};

describe("u6119 a Workstream's child shows no dot", () => {
  it("u6119b_a_child_finish_is_not_unseen_and_its_need_reaches_the_door", async () => {
    const { app } = await fixture();

    fireEvent.click(row("other"));
    status(app, "child", 2, "idle", "1");
    status(app, "top", 2, "idle", "1");
    await waitFor(() => expect(unread(row("top"))).toBe(true));
    expect(unread(row("child"))).toBe(false);
    expect(unread(row("w"))).toBe(false);

    fireEvent.click(within(row("w")).getByRole("button", { name: "Collapse" }));
    expect(unread(row("w"))).toBe(false);

    status(app, "w", 2, "idle", "1");
    await waitFor(() => expect(unread(row("w"))).toBe(true));

    status(app, "child", 3, "needs-you", "1");
    await waitFor(() => expect(row("w").querySelector("[data-kind]")?.getAttribute("data-kind")).toBe("needs-you"));
  });

  it("u6119c_a_child_terminal_tab_shows_no_unseen_output", async () => {
    const tree = [workstream("w"), agent("child", "working", "x", { parent: "w" }), agent("top", "working", "x"), workstream("o", { order: 1 })];
    const terminals = [info("1", { owner: "child", title: "child run" }), info("3", { owner: "top", title: "top run" })];
    const mounted = await mountBubbles("o", terminals, tree);
    const dot = (id: string) => document.querySelector(`.terminal-tab[data-bubble="${id}"] [data-state]`);

    for (const id of ["1", "3"]) await waitFor(() => expect(mounted.app.outputSubscriptions.some((subscription) => subscription.id === id)).toBe(true));
    for (const id of ["1", "3"]) mounted.app.emitOutput(id, "building");

    mounted.connected.rail.select("top");
    await waitFor(() => expect(dot("3")).not.toBeNull());

    mounted.connected.rail.select("child");
    await waitFor(() => expect(document.querySelector('.terminal-tab[data-bubble="1"]')).not.toBeNull());
    expect(dot("1")).toBeNull();
  });

  it("u6119c_menu_bar_ready_rows_skip_workstream_children", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { app } = await openTabs({ api: [door("w", "working", "x"), agent("child", "working", "x", { parent: "w" }), agent("top", "working", "x"), agent("other", "working", "x")] }, false, Date.now);
    const labels = () => app.menuBar?.entries.map((entry) => entry.label);

    fireEvent.click(row("other"));
    status(app, "child", 2, "idle", "1");
    status(app, "top", 2, "idle", "1");
    await waitFor(() => expect(labels()).toEqual(["Ready", "Top", "Open roundup"]));

    status(app, "child", 3, "needs-you", "1");
    await waitFor(() => expect(labels()).toEqual(["Waiting", "Child", "Ready", "Top", "Open roundup"]));
  });

  it("u6119c_project_tab_and_dock_count_only_what_needs_the_user", async () => {
    const { app } = await fixture();
    const mark = () => tab("api").querySelector(".tab-mark")?.getAttribute("aria-label") ?? null;
    const dock = () => app.badges.at(-1) ?? 0;

    fireEvent.click(row("other"));
    status(app, "top", 2, "idle", "1");
    await waitFor(() => expect(unread(row("top"))).toBe(true));
    fireEvent.click(tab("observer"));
    const before = [mark(), dock()];

    status(app, "child", 2, "idle", "1");
    fireEvent.click(tab("api"));
    await waitFor(() => expect(unread(row("top"))).toBe(true));
    expect(unread(row("child"))).toBe(false);
    fireEvent.click(tab("observer"));
    expect([mark(), dock()]).toEqual(before);
    expect(before).toEqual([null, 0]);

    status(app, "child", 3, "needs-you", "1");
    await waitFor(() => expect(mark()).toBe("Needs you"));
    expect(dock()).toBe(1);
  });

  it("u6119c_inbox_comments_and_overview_sections_stay_unseen_until_opened", async () => {
    window.localStorage.clear();
    const app = createFakeApp();
    app.handlers["rail.tree"] = () => [workstream("w"), agent("child", "working", "x", { parent: "w" })];
    app.handlers["ask.list"] = () => [{ ...ask("same-id", 1000, [{ text: "same text", placement: { kind: "routed", workstream: "w" }, state: "typed" }]), at: 1000n }];
    app.handlers["deliverable.list"] = () => [{ project: "p", id: "made", maker: { kind: "user", id: "you", parent: null }, maker_name: "Me", home: null, title: "made", published_at: 3000, target: { kind: "external", url: "https://example.com/r", availability: "not-checked" } }];
    const connected = await connectProject(app, { name: "p", path: `/unseen-${crypto.randomUUID()}` }, () => true, () => 0);

    render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
    await connected.rail.settled();
    await waitFor(() => expect(document.querySelectorAll(".overview-sections [data-part=item-trigger]")).toHaveLength(3));
    expect(document.querySelectorAll(".overview-unseen").length).toBeGreaterThan(0);
  });

  it.each([
    { name: "a pending question", kind: "needs-you", label: "question", mark: "Needs you", dock: 1, waiting: true },
    { name: "a permission ask", kind: "needs-you", label: "permission", mark: "Needs you", dock: 1, waiting: true },
    { name: "an error", kind: "error", label: "failure", mark: "Error", dock: 1, waiting: true },
  ] as const)("u6119d_no_attention_marker_is_hidden: $name", async ({ kind, label, mark, dock }) => {
    const { app } = await fixture();

    fireEvent.click(within(row("w")).getByRole("button", { name: "Collapse" }));
    app.of(path("api")).emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind, label, since: 2, finished: "0" } } }));
    await waitFor(() => expect(row("w").querySelector("[data-kind]")?.getAttribute("data-kind")).toBe(kind));
    fireEvent.click(tab("observer"));
    await waitFor(() => expect(tab("api").querySelector(".tab-mark")?.getAttribute("aria-label")).toBe(mark));
    expect(app.badges.at(-1)).toBe(dock);
    await waitFor(() => expect(app.menuBar?.entries.map((entry) => [entry.label, entry.subtitle])).toEqual([["Waiting", undefined], ["Child", expect.stringContaining(label)], ["Open roundup", undefined]]));
  });

  it("u6119d_no_attention_marker_is_hidden: a finished Door", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { app } = await fixture(Date.now);

    fireEvent.click(row("other"));
    status(app, "w", 2, "idle", "1");
    await waitFor(() => expect(unread(row("w"))).toBe(true));
    await waitFor(() => expect(app.menuBar?.entries.map((entry) => entry.label)).toEqual(["Ready", "W", "Open roundup"]));
  });
});
