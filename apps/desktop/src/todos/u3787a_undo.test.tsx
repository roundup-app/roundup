import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { TodoHost } from "./TodoDrawer";
import { todo } from "./testHarness";
import type { ConnectedProject } from "../state/connectedProject";
import { questionProbe } from "../testing/menuProbe";
import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { useBrowserStorage } from "../state/storage";

stubDialogLayout();
afterEach(cleanup);

const mount = async () => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  const connections = new Map<string, ConnectedProject>();
  for (const path of ["/a", "/b"]) {
    app.add(path);
    const daemon = app.of(path);
    daemon.handlers["todo.list"] = () => [todo(5), todo(7)];
    daemon.handlers["todo.getHistory"] = () => [];
    daemon.handlers["todo.comments"] = () => [];
    daemon.handlers["todo.refs"] = () => [];
    daemon.handlers["todo.delete"] = p => ({ operation: p.operation, deleted: p.ids, missing: [], state: "deleted" });
    daemon.handlers["todo.restore"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "restored" });
  }
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} prepareIdle={open => { connections.set(open.project.path, open); }} />);
  await waitFor(() => expect(connections.size).toBe(2));
  const remove = async (path: string, id = 5) => {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${path.slice(1)}`) }));
    connections.get(path)!.drawer.open(() => <TodoHost id={id} />, "key");
    const button = await within(screen.getByRole("complementary", { name: "Drawer" })).findByRole("button", { name: "Delete Todo" });
    fireEvent.click(button);
    return button;
  };
  return { app, connections, remove };
};

it("u3787a_delete_has_no_question_and_freezes_targets", async () => {
  const { app, remove, connections } = await mount();
  let finish!: (value: { operation: string; deleted: number[]; missing: number[]; state: "deleted" }) => void;
  app.of("/a").handlers["todo.delete"] = () => new Promise(resolve => { finish = resolve; });
  const button = await remove("/a");
  fireEvent.click(button);
  const calls = app.of("/a").calls.filter(c => c.method === "todo.delete");
  expect(calls).toEqual([{ method: "todo.delete", params: { operation: expect.any(String), ids: [5] } }]);
  expect(questionProbe.shown).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  const operation = (calls[0]!.params as { operation: string }).operation;
  finish({ operation, deleted: [5], missing: [], state: "deleted" });
  await screen.findByRole("button", { name: "Undo" });
  expect(connections.get("/a")!.drawer.content()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(app.of("/a").calls.filter(c => c.method === "todo.restore")).toEqual([{ method: "todo.restore", params: { operation } }]));
});
