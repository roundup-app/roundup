import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import { RpcError } from "../../app/seam";
import { agent, workstream } from "../../testing/nodes";
import { USER } from "../../testing/nodes";
import { mountRail, rowOf } from "../railFixture";

afterEach(cleanup);

const openAt = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });

const item = (name: string) => screen.getByRole("menuitem", { name });

const todo = (id: number, home: string | null, done: boolean): Todo =>
  ({ id, title: `t${id}`, body: "", done, blockers: [], blocked: false, created_at: 0, creator: USER, home });

const pad = (name: string, home: string | null, owner = USER): Pad => ({ name, owner, text: "", updated_at: 0, home, scribe: null });

// SAFETY: the test fills only the fields the removal count reads.
const state = (dirty: boolean, ahead: number): WorktreeState => ({ dirty, ahead }) as WorktreeState;

const withTree = async (tree: Parameters<typeof mountRail>[0], todos: Todo[] = [], pads: Pad[] = [], states: Record<string, WorktreeState> = {}) => {
  const mounted = await mountRail(tree, [], undefined, undefined, undefined, pads);
  mounted.app.handlers["todo.list"] = () => todos;
  mounted.app.handlers["agent.worktreeState"] = ({ id }) => states[id] ?? state(false, 0);
  mounted.app.handlers["rail.remove"] = () => ({ removed: [], kept: [] });

  return mounted;
};

// SAFETY: a stand-in Worktree; only its presence matters to the count.
const worktree = { path: "/w", branch: "b" } as never;

const calls = (app: Awaited<ReturnType<typeof withTree>>["app"], method: string) => app.calls.filter((call) => call.method === method);

describe("u367 the Workstream confirm", () => {
  it("u367_the_confirm_always_asks_for_a_workstream", async () => {
    const { app } = await withTree([workstream("g")]);
    openAt("g");

    fireEvent.click(item("remove"));

    expect(await screen.findByText("goes: nothing")).toBeTruthy();
    expect(calls(app, "rail.remove")).toEqual([]);
    expect(screen.getByRole("menuitem", { name: "keep" })).toBeTruthy();
    expect(["todo.create", "todo.update", "pad.write", "agent.stop"].some((method) => calls(app, method).length > 0)).toBe(false);
  });

  it("u367_goes_and_stays_lines_count_what_a34_judges", async () => {
    await withTree(
      [workstream("g"), agent("a", "done", "done", { parent: "g" }), agent("b", "done", "done", { parent: "g" }), agent("c", "working", "busy", { parent: "g" })],
      [todo(1, "g", true), todo(2, "g", true), todo(3, "g", false), todo(4, "other", true)],
      [pad("p1", "g"), pad("p2", "g", { kind: "agent", id: "c", parent: null }), pad("p3", "other")],
    );
    openAt("g");

    fireEvent.click(item("remove"));

    expect(await screen.findByText("goes: 2 agents, 2 done todos, 1 pads")).toBeTruthy();
    expect(screen.getByText("stays at the project root: 1 agents, 1 open todos, 1 pads")).toBeTruthy();
  });

  it("u367_each_kept_agent_names_its_reason", async () => {
    await withTree(
      [
        workstream("g"),
        agent("run", "working", "busy", { parent: "g" }),
        agent("ahead", "done", "done", { parent: "g", worktree }),
        agent("dirty", "error", "failed", { parent: "g", worktree }),
      ],
      [],
      [],
      { ahead: state(false, 3), dirty: state(true, 0) },
    );
    openAt("g");

    fireEvent.click(item("remove"));

    expect(await screen.findByText("run: running")).toBeTruthy();
    expect(screen.getByText("ahead: unlanded work: 3 ahead")).toBeTruthy();
    expect(screen.getByText("dirty: unlanded work: uncommitted changes")).toBeTruthy();
  });

  it("u367_enter_calls_once_and_esc_calls_nothing", async () => {
    const { app } = await withTree([workstream("g")]);
    openAt("g");
    fireEvent.click(item("remove"));
    await screen.findByText("goes: nothing");

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(calls(app, "rail.remove")).toEqual([]);

    openAt("g");
    fireEvent.click(item("remove"));
    await screen.findByText("goes: nothing");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });

    await waitFor(() => expect(calls(app, "rail.remove")).toEqual([{ method: "rail.remove", params: { id: "g" } }]));
  });

  it("u367_a_long_name_is_cut_and_no_row_moves", async () => {
    const long = "a-very-long-agent-name-".repeat(8);
    const { rail } = await withTree([workstream("g"), agent("a", "done", "done", { parent: "g", name: long })]);
    const before = rail.nodes.map((node) => node.id);
    openAt("g");

    fireEvent.click(item("remove"));

    const line = await screen.findByText(long, { selector: ".rail-menu-name" });
    expect(line.classList.contains("rail-menu-line")).toBe(true);
    expect(rail.nodes.map((node) => node.id)).toEqual(before);
  });

  it("u367_a_failed_removal_shows_the_message", async () => {
    const { app, rail } = await withTree([workstream("g")]);
    app.handlers["rail.remove"] = () => Promise.reject(new RpcError(-32603, "cannot remove"));
    openAt("g");
    fireEvent.click(item("remove"));
    await screen.findByText("goes: nothing");

    fireEvent.click(item("remove"));

    expect(await screen.findByText(/cannot remove/)).toBeTruthy();
    expect(rail.nodes.map((node) => node.id)).toEqual(["g"]);
  });
});
