import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, path, tab } from "../header/stripFixture";
import { agent, event, info, workstream } from "../testing/nodes";
import type { FakeApp } from "../testing/fakeApp";
import { nextAttention } from "./attention";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });

const blocked = { kind: "needs-you", label: "Allow?", since: 5, finished: "0" } as const;

const failed = { ...blocked, kind: "error", label: "exit 1" } as const;

/** The rows the menu bar lists as Waiting: the entries whose disc is `needs-you` or `error`. */
const waiting = (app: FakeApp) => app.menuBar?.entries.flatMap(entry => entry.action && (entry.state === "needs-you" || entry.state === "error") ? [entry.action] : []) ?? [];

const listing = async (app: FakeApp, project: string, terminals: () => ReturnType<typeof info>[]) => {
  app.of(path(project)).handlers["terminal.list"] = terminals;
  app.of(path(project)).emit(event({ name: "terminal.changed" }));
};

it("u7189a_the_dock_count_equals_the_menu_bars_waiting_rows", async () => {
  const { app } = await openTabs({
    api: [
      agent("need", "needs-you", "question"),
      agent("fail", "error", "failed"),
      agent("quiet", "needs-you", "question", { alert_level: "quiet" }),
      workstream("unstarted", { status: { kind: "needs-you", label: "question", since: 1, finished: "0" } }),
      agent("stopped", "done", "stopped", { terminal_id: null }),
    ],
    web: [agent("pane", "working", "running", { terminal_id: "t-pane" }), agent("broken", "error", "failed")],
  });

  await listing(app, "api", () => [info("free", { title: "npm run dev --port 5199", status: blocked }), info("ended", { owner: "stopped", running: false, exit_code: 1, status: failed }), info("busy", { status: { ...blocked, kind: "working" } })]);
  await listing(app, "web", () => [info("t-pane", { owner: "pane", status: blocked })]);

  // Four in api (two Agents, a free Terminal, a stopped Agent's ended Terminal) and one in web; a Quiet or unstarted node, an Agent's own pane and a working Terminal count nowhere.
  await waitFor(() => expect(waiting(app)).toHaveLength(5));
  expect(app.badges.at(-1)).toBe(5);
  expect(waiting(app).flatMap(action => action.kind === "terminal" ? [action.terminal] : []).toSorted()).toEqual(["ended", "free"]);
  // A Terminal's row names it as the Bubble does, not with an Agent's name rewritten into a sentence.
  expect(app.menuBar?.entries.find(entry => entry.action?.kind === "terminal" && entry.action.terminal === "free")?.label).toBe("npm run dev --port 5199");
});

it("u7189b_opening_a_waiting_terminal_clears_it_until_its_status_changes", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "running")], web: [] });
  let listed = [info("free", { status: blocked })];

  await listing(app, "api", () => listed);
  await waitFor(() => expect(app.badges.at(-1)).toBe(1));
  const [row] = waiting(app);

  if (!row) throw new Error("no Waiting row");

  app.menuBarAction(row);

  await waitFor(() => expect(app.badges.at(-1)).toBe(0));
  expect(waiting(app)).toEqual([]);
  expect(tab("api").getAttribute("aria-selected")).toBe("true");

  // A new status is news again; the same status, listed again, is not.
  await listing(app, "api", () => listed);
  expect(app.badges.at(-1)).toBe(0);
  listed = [info("free", { status: { ...blocked, since: 9 } })];
  await listing(app, "api", () => listed);
  await waitFor(() => expect(app.badges.at(-1)).toBe(1));
});

it("u7189c_a_closed_terminal_leaves_the_count_and_the_rows", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "running")], web: [] });

  await listing(app, "api", () => [info("free", { status: failed })]);
  await waitFor(() => expect(waiting(app)).toHaveLength(1));
  expect(app.badges.at(-1)).toBe(1);

  await listing(app, "api", () => []);
  await waitFor(() => expect(waiting(app)).toEqual([]));
  expect(app.badges.at(-1)).toBe(0);
});

it("u7189d_jump_visits_the_agents_on_the_list_and_skips_the_ones_the_menu_bar_does_not_show", () => {
  const nodes = [
    agent("a", "needs-you", "question"),
    agent("e", "error", "failed"),
    agent("quiet", "error", "failed", { alert_level: "quiet" }),
    workstream("unstarted", { status: blocked }),
  ];

  expect([null, "e", "a"].map(selected => nextAttention(nodes, selected)?.id)).toEqual(["e", "a", "e"]);
  expect(nextAttention([], null)).toBeNull();
});
