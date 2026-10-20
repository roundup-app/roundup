import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { Todo } from "@contracts/todo/Todo";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { showEverything } from "../testing/showEverything";
import { Todos } from "./Todos";

let real: StartedDaemon;

beforeAll(async () => { real = await startRealDaemon({}, true); }, 240_000);

afterAll(async () => { await real?.stop(); });

afterEach(cleanup);

const groupOf = (id: number) => document.querySelector(`[data-todo="${id}"]`)?.closest("[data-shelf-group]")?.getAttribute("data-shelf-group");

it("u3720_real_daemon_owner_assign", async () => {
  const app = createServedApp(real.base);
  const agent = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: "owner maker" });
  const moved = await app.rpc("todo.create", { title: "to assign", body: null, blockers: null });
  const connected = await connectProject(app, { name: "owners", path: real.dir }, () => true, () => 0);

  await showEverything(connected);
  render(() => <ConnectedProjectContext.Provider value={connected}><Todos /></ConnectedProjectContext.Provider>);

  const owner = async (id: number): Promise<Todo["owner"]> => (await app.rpc("todo.list", null)).find((each: Todo) => each.id === id)!.owner;

  await waitFor(() => expect(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);

  // `o` and the keyboard alone: Unassigned to the Agent.
  const row = await screen.findByRole("button", { name: new RegExp(`^Idle #${moved.id} `) });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO" });
  const list = await screen.findByRole("menu", { name: `Owners for #${moved.id}` });

  fireEvent.click(within(list).getByText("owner maker"));
  await waitFor(async () => expect((await owner(moved.id))?.id).toBe(agent.id));
  await waitFor(() => expect(groupOf(moved.id)).toBe(agent.id));
  await waitFor(() => expect(document.activeElement?.closest("[data-todo]")?.getAttribute("data-todo")).toBe(String(moved.id)));

  // The Agent's group back to Me through the Assign word.
  fireEvent.click(await screen.findByRole("button", { name: `assign #${moved.id}`, hidden: true }));
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Me"));
  await waitFor(async () => expect((await owner(moved.id))?.kind).toBe("user"));
  await waitFor(() => expect(groupOf(moved.id)).toBe("me"));
  await waitFor(() => expect(document.activeElement?.closest("[data-todo]")?.getAttribute("data-todo")).toBe(String(moved.id)));

  // A Todo added through Me's plus is owned by Me.
  fireEvent.click(screen.getByRole("button", { name: "add todo to Me" }));
  const field = await screen.findByRole("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: "made in group" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(async () => expect((await app.rpc("todo.list", null)).find((each: Todo) => each.title === "made in group")?.owner?.kind).toBe("user"));
  const made = (await app.rpc("todo.list", null)).find((each: Todo) => each.title === "made in group")!;

  await waitFor(() => expect(groupOf(made.id)).toBe("me"));
}, 120_000);
