import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Pad } from "@contracts/pad/Pad";
import { todo } from "../todos/testHarness";
import { agent, event } from "../testing/nodes";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

const REFUSED = "daemon said no";

const refuse = () => { throw new Error(REFUSED); };

const owned = (name: string, by: string): Pad => ({ incarnation: `fixture-${name}`, name, owner: { kind: "agent", id: by, parent: null }, text: "old", updated_at: 0, revision: 1, home: null });

/** Row `a` fails to remove; the Rail's line is the failure. */
const failedRemove = async () => {
  let tree = [agent("a", "idle", "x"), agent("b", "idle", "x", { order: 1 })];
  const mounted = await mountRail(tree);
  mounted.app.handlers["rail.tree"] = () => tree;
  mounted.app.handlers["rail.remove"] = refuse;
  mounted.rail.select("a");
  rowOf("a").focus();
  fireEvent.keyDown(rowOf("a"), { key: "Backspace", code: "Backspace", metaKey: true });
  await waitFor(() => expect(screen.getByText(new RegExp(REFUSED))).toBeTruthy());

  return { ...mounted, drop: (id: string) => { tree = tree.filter((node) => node.id !== id); } };
};

describe("p3557c an item failure in the Rail goes with its item", () => {
  it("p3557c_failure_lifetime_rail_deleted_item_clears", async () => {
    const { rail, drop } = await failedRemove();
    drop("a");
    await rail.refresh();
    await waitFor(() => expect(screen.queryByText(new RegExp(REFUSED))).toBeNull());
    expect(rowOf("b")).toBeTruthy();
  });

  it("p3557c_failure_lifetime_rail_unrelated_deletion_keeps_it", async () => {
    const { rail, drop } = await failedRemove();
    drop("b");
    await rail.refresh();
    await waitFor(() => expect(screen.queryByText("b")).toBeNull());
    expect(screen.getByText(new RegExp(REFUSED))).toBeTruthy();
    expect(rowOf("a")).toBeTruthy();
  });

  it("p3557c_failure_lifetime_rail_acknowledged_retry_clears", async () => {
    const { app } = await failedRemove();
    app.handlers["rail.remove"] = () => null;
    fireEvent.keyDown(rowOf("a"), { key: "Backspace", code: "Backspace", metaKey: true });
    await waitFor(() => expect(screen.queryByText(new RegExp(REFUSED))).toBeNull());
  });

  it("p3557c_failure_lifetime_rail_dismissal_clears_it", async () => {
    await failedRemove();
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByText(new RegExp(REFUSED))).toBeNull());
    expect(rowOf("a")).toBeTruthy();
  });
});

const by = { kind: "agent", id: "a1", parent: null } as const;

/** One Agent owning two items of `kind`; the first one's action fails and the Agent row shows it. */
const mountItems = async (kind: "pad" | "todo") => {
  const store: TodoStore = { todos: [todo(1, { creator: by }), todo(2, { creator: by })] };
  let pads = [owned("notes", "a1"), owned("plan", "a1")];
  const mounted = await mountRail([agent("a1", "working", "x", { name: "auth" })], [], undefined, () => true, { drawer: true }, pads);
  Object.assign(mounted.app.handlers, todoHandlers(store, (data) => mounted.app.emit(event(data))));
  mounted.app.handlers["pad.list"] = () => pads;

  for (const each of store.todos) mounted.app.emit(event({ name: "todo.created", data: each }));
  mounted.app.handlers["todo.complete"] = refuse;
  mounted.app.clipboardWrite = () => Promise.reject(new Error(REFUSED));
  fireEvent.click(await within(rowOf("auth")).findByRole("button", { name: /(pads|todos)$/ }));

  const leaf = async (n: number) => kind === "pad"
    ? (await screen.findByRole("button", { name: n === 1 ? "notes" : "plan" })).closest("[data-leaf]")!
    : (await screen.findByText(`todo ${n}`)).closest("[data-leaf]")!;

  const target = async (n: number) => kind === "pad" ? screen.findByRole("button", { name: n === 1 ? "notes" : "plan" }) : leaf(n);

  const fail = async (n: number) => {
    fireEvent.contextMenu(await target(n), { clientX: 1, clientY: 1 });
    await mounted.app.pickMenu(kind === "pad" ? "Copy Link" : "Complete");
    await waitFor(() => expect(within(rowOf("auth")).getByText(new RegExp(REFUSED))).toBeTruthy());
  };

  const remove = (n: number) => {
    if (kind === "pad") {
      pads = pads.filter((pad) => pad.name !== (n === 1 ? "notes" : "plan"));
      mounted.app.emit(event({ name: "pad.deleted", data: { name: n === 1 ? "notes" : "plan" } }));
    } else {
      store.todos = store.todos.filter((each) => each.id !== n);
      mounted.app.emit(event({ name: "todo.deleted", data: { id: n } }));
    }
  };

  return { ...mounted, leaf, fail, remove };
};

describe.each(["pad", "todo"] as const)("p3557c an Agent's %s failure goes with its item", (kind) => {
  const shown = () => within(rowOf("auth")).queryByText(new RegExp(REFUSED));

  it(`p3557c_failure_lifetime_agent_pads_${kind}_deleted_item_clears`, async () => {
    const { fail, remove, leaf } = await mountItems(kind);
    await fail(1);
    remove(1);
    await waitFor(() => expect(shown()).toBeNull());
    expect(await leaf(2)).toBeTruthy();
  });

  it(`p3557c_failure_lifetime_agent_pads_${kind}_unrelated_deletion_keeps_it_and_dismissal_clears`, async () => {
    const { fail, remove, leaf } = await mountItems(kind);
    await fail(1);
    remove(2);
    await waitFor(() => expect(screen.queryByText(kind === "pad" ? "plan" : "todo 2")).toBeNull());
    expect(shown()).toBeTruthy();
    expect(await leaf(1)).toBeTruthy();
    fireEvent.click(within(rowOf("auth")).getByRole("button", { name: "Close" }));
    expect(shown()).toBeNull();
    expect(await leaf(1)).toBeTruthy();
  });

  it.runIf(kind === "todo")("p3557c_failure_lifetime_agent_pads_todo_acknowledged_save_clears_it", async () => {
    const { app, fail, leaf } = await mountItems(kind);
    await fail(1);
    app.handlers["todo.complete"] = () => todo(1, { done: true });
    fireEvent.contextMenu(await leaf(1), { clientX: 1, clientY: 1 });
    await app.pickMenu("Complete");
    await waitFor(() => expect(shown()).toBeNull());
  });
});
