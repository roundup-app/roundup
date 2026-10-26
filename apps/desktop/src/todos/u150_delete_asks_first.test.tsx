import { questionProbe } from "../testing/menuProbe";
import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";
import { USER } from "../testing/nodes";

afterEach(cleanup);

stubDialogLayout();

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async () => {
  const mounted = await mountTodos([todo(5, { title: "session store" }), todo(7, { title: "other" })], true);
  fireEvent.keyDown(await screen.findByRole("button", { name: /#5/ }), { key: "Enter" });
  await within(drawer()).findByText("Blocker");

  return mounted;
};

const ask = async () => {
  fireEvent.click(within(drawer()).getByRole("button", { name: "Delete Todo" }));

};

describe("u150 Todo deletion", () => {


  it("u3787a_acknowledged_delete_closes_with_no_deleted_line", async () => {
    const { app } = await open();
    app.handlers["todo.delete"] = (params) => ({ operation: params.operation, deleted: params.ids, missing: [], state: "deleted" });
    await ask();

    app.emit({ actor: USER, name: "todo.deleted", data: { id: 5 } });

    await waitFor(() => expect(screen.getByRole<HTMLElement>("complementary").inert).toBe(true));
    expect([callsTo(app, "todo.delete"), screen.queryByText(/was deleted/)]).toEqual([[{ method: "todo.delete", params: { operation: expect.any(String), ids: [5] } }], null]);
  });

  it("u150_the_row_leaves_the_list_after_todo_deleted", async () => {
    const { app, store } = await mountTodos([todo(5, { title: "session store" }), todo(7, { title: "other" })], true);
    app.handlers["todo.delete"] = (params) => {
      store.todos = store.todos.filter((each) => each.id !== 5);

      return { operation: params.operation, deleted: params.ids, missing: [], state: "deleted" };
    };

    fireEvent.keyDown(await screen.findByRole("button", { name: /#5/ }), { key: "Enter" });
    await within(drawer()).findByText("Blocker");
    await ask();
    app.emit({ actor: USER, name: "todo.deleted", data: { id: 5 } });

    await waitFor(() => expect(screen.queryByRole("button", { name: /#5/ })).toBeNull());
    expect(screen.getByRole("button", { name: /#7/ })).toBeTruthy();
  });





  it("u150_an_error_keeps_the_drawer_and_the_item", async () => {
    const { app, connected } = await open();
    app.handlers["todo.delete"] = () => Promise.reject(new RpcError(-32001, "not found"));
    await ask();


    expect([(await screen.findByText(/not found/)).textContent, connected.drawer.content() === null]).toEqual(["not found", false]);
    await waitFor(() => expect(questionProbe.shown).toBeNull());
    expect(screen.getAllByRole("button", { name: /#5/ }).length).toBeGreaterThan(0);
  });
});
