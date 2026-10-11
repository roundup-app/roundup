import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { RpcError } from "../../app/seam";
import { agent, USER, workstream } from "../../testing/nodes";
import type { FakeApp } from "../../testing/fakeApp";
import { mountRail, railCallsTo, rowOf } from "../railFixture";

afterEach(cleanup);

const worktree = (branch: string) => ({ path: `/p/.roundup/worktrees/${branch}`, branch, base: "main" });

const todo = (id: number, home: string | null, done: boolean): Todo => ({
  id,
  title: `todo ${id}`,
  body: "",
  done,
  blockers: [],
  blocked: false,
  created_at: 0,
  creator: USER,
  home,
});

const pad = (name: string, home: string | null, owner: string | null): Pad => ({
  name,
  owner: owner === null ? USER : { kind: "agent", id: owner, parent: null },
  text: "",
  updated_at: 0,
  home,
  scribe: null,
});

const states = {
  ahead: { ahead: 3, behind: 0, dirty: false },
  dirty: { ahead: 0, behind: 0, dirty: true },
  clean: { ahead: 0, behind: 0, dirty: false },
} satisfies Record<string, WorktreeState>;

const mount = async (tree: ReturnType<typeof agent>[], todos: Todo[] = [], pads: Pad[] = []) => {
  const mounted = await mountRail(tree, [], undefined, undefined, {}, pads);
  mounted.app.handlers["todo.list"] = () => todos;
  mounted.app.handlers["agent.worktreeState"] = ({ id }) => (id === "ahead" || id === "dirty" ? states[id] : states.clean);
  mounted.app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });

  return mounted;
};

const removals = (app: FakeApp) => railCallsTo(app, "rail.remove");

const openConfirm = async (name: string) => {
  fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });
  fireEvent.click(screen.getByRole("menuitem", { name: "remove" }));
  await screen.findByRole("menuitem", { name: "keep" });
};

const lines = () => [...document.querySelectorAll(".rail-menu-line")].map((line) => line.textContent);

describe("u367 the confirm lists what goes and what stays", () => {
  it("u367_the_confirm_always_asks_for_a_workstream", async () => {
    const { app } = await mount([workstream("w")]);

    await openConfirm("w");

    expect(removals(app)).toEqual([]);
    expect(lines()).toEqual(["goes: nothing"]);
  });

  it("u367_goes_and_stays_lines_count_what_a34_judges", async () => {
    const { app } = await mount(
      [
        workstream("w"),
        agent("done", "done", "x", { parent: "w", worktree: worktree("clean") }),
        agent("busy", "working", "x", { parent: "w" }),
        agent("plain", "done", "x", { parent: "w" }),
      ],
      [todo(1, "w", true), todo(2, "w", false), todo(3, "w", false), todo(4, null, true)],
      [pad("a", "w", "busy"), pad("b", "w", null), pad("c", "w", "done"), pad("d", null, null)],
    );

    await openConfirm("w");

    expect(lines()).toEqual([
      "goes: 2 agents, 1 done todos, 2 pads",
      "done",
      "plain",
      "stays at the project root: 1 agents, 2 open todos, 1 pads",
      "busy: running",
    ]);
    expect(removals(app)).toEqual([]);
    expect(railCallsTo(app, "agent.stop")).toEqual([]);
  });

  it("u367_each_kept_agent_names_its_reason", async () => {
    const { app } = await mount([
      workstream("w"),
      agent("busy", "working", "x", { parent: "w" }),
      agent("ahead", "done", "x", { parent: "w", worktree: worktree("ahead") }),
      agent("dirty", "error", "x", { parent: "w", worktree: worktree("dirty") }),
      agent("nested", "done", "x", { parent: "busy", worktree: worktree("clean") }),
    ]);

    await openConfirm("w");

    expect(lines()).toEqual([
      "goes: 1 agents",
      "nested",
      "stays at the project root: 3 agents",
      "busy: running",
      "ahead: unlanded work: 3 ahead",
      "dirty: unlanded work: uncommitted changes",
    ]);
    expect(app.calls.filter((call) => call.method === "agent.worktreeState").map((call) => call.params)).toEqual([
      { id: "ahead" },
      { id: "dirty" },
      { id: "nested" },
    ]);
  });

  it("u367_enter_calls_once_and_esc_calls_nothing", async () => {
    const { app } = await mount([workstream("w")]);

    await openConfirm("w");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(removals(app)).toEqual([]);

    await openConfirm("w");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });

    await waitFor(() => expect(removals(app)).toEqual([{ id: "w" }]));
    expect(screen.queryByRole("menu")).toBeNull();

    await openConfirm("w");
    fireEvent.click(screen.getByRole("menuitem", { name: "keep" }));
    expect(removals(app)).toEqual([{ id: "w" }]);
  });

  it("u367_a_long_name_is_cut_and_no_row_moves", async () => {
    const { app } = await mount([
      workstream("w"),
      ...["a", "b", "c", "d", "e"].map((id) => agent(id, "done", "x", { parent: "w", name: `${id} ${"very long ".repeat(20)}` })),
    ]);

    const rows = () => [...document.querySelectorAll("[role=treeitem][data-id]")].map((row) => row.getAttribute("data-id"));
    const before = rows();

    await openConfirm("w");

    expect(lines().slice(0, 5)).toEqual([
      "goes: 5 agents",
      expect.stringMatching(/^a very long/),
      expect.stringMatching(/^b very long/),
      expect.stringMatching(/^c very long/),
      "+ 2 more",
    ]);
    expect(rows()).toEqual(before);
    expect(removals(app)).toEqual([]);
  });

  it("u367_a_failed_removal_shows_the_message", async () => {
    const { app } = await mount([workstream("w")]);
    app.handlers["rail.remove"] = () => {
      throw new RpcError(-32000, "disk full");
    };

    await openConfirm("w");
    fireEvent.click(screen.getByRole("menuitem", { name: "remove" }));

    await waitFor(() => expect(screen.getByText(/disk full/)).toBeTruthy());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(rowOf("w")).toBeTruthy();
  });
});
