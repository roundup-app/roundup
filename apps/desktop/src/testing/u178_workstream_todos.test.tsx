import { copy as recoveryCopy } from "../sharedCopy";
import { createNow, DisplayClockContext } from "../state/clock";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { StartedDaemon } from "./realDaemonFixture";
import { connectProject, ConnectedProjectContext, createProjectDrafts } from "../state/connectedProject";
import { showEverything } from "./showEverything";
import { DrawerHost } from "../drawer/DrawerHost";
import { Todos } from "../todos/Todos";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startRealDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";

describe("u2773 unfinished Todos through the real Daemon", () => {

let one: StartedDaemon;

let two: StartedDaemon;

beforeAll(async () => {
  one = await startRealDaemon({});
  two = await startRealDaemon({});
}, 240_000);

afterAll(async () => { await two?.stop(); await one?.stop(); });

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const mount = async (real: StartedDaemon, draftsFor = createProjectDrafts()) => {
  const app = createServedApp(real.base);
  const calls: string[] = [];
  const rpc = app.rpc;

  app.rpc = (method, params) => { calls.push(method);

 return rpc(method, params); };

  const connected = await connectProject(app, { name: "same Project", path: real.dir }, () => true, () => 0,
    () => null, undefined, draftsFor(real.dir));

  await showEverything(connected);

  const rendered = render(() => {
    const now = createNow(() => 0, () => false);

    return <DisplayClockContext.Provider value={now.subscribe}><ConnectedProjectContext.Provider value={connected}>
    <Todos /><DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
  </ConnectedProjectContext.Provider></DisplayClockContext.Provider>;
  });

  await waitFor(() => expect(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);

  return { ...rendered, connected, app, calls };
};

const openBody = async (id: number, body: string) => {
  const focusedRow = await screen.findByRole("button", { name: new RegExp(`^Idle #${id} `) });
  focusedRow.focus();
  fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" });
  const drawer = screen.getByRole("complementary", { name: "Drawer" });

  await within(drawer).findByRole("button", { name: /^Changes/ });
  fireEvent.dblClick(within(drawer).getByText(body));

  return within(drawer).getByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
};

it("u2773c_todos_external_change_keeps_original_at_real_daemon", async () => {
  const external = createServedApp(one.base);
  const original = await external.rpc("todo.create", { title: "conflict target", body: "original base", blockers: null });
  const { connected, app } = await mount(one);
  const field = await openBody(original.id, "original base");

  fireEvent.input(field, { target: { value: "  my edit\n🧪  " } });
  const captured = connected.drafts.list().find(draft => draft.destination.object === String(original.id))!;

  await external.rpc("todo.update", { id: original.id, title: null, body: "another Actor" });
  await screen.findByText(/Changed Todo/);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect((await app.rpc("todo.get", { id: original.id })).body).toBe("another Actor");
  expect(connected.drafts.list().find(draft => draft.status === "failed")?.value).toEqual(captured.value);
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveProperty("value", "  my edit\n🧪  ");
}, 60_000);

it("u2773c_todos_unavailable_original_keeps_project_local_recovery", async () => {
  const external = createServedApp(two.base);
  const original = await external.rpc("todo.create", { title: "removed original", body: "base to remove", blockers: null });
  const { connected, app } = await mount(two);
  const field = await openBody(original.id, "base to remove");

  fireEvent.input(field, { target: { value: "  recover after removal 🧪  " } });
  connected.drawer.close("key");
  await external.rpc("todo.delete", { operation: crypto.randomUUID(), ids: [original.id] });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(String(original.id)));
  expect(connected.drafts.list().find(draft => draft.destination.object === String(original.id))?.value.text).toBe("  recover after removal 🧪  ");
  fireEvent.click(screen.getByRole("button", { name: recoveryCopy.discardRevision }));
  expect(connected.drafts.list()).toEqual([]);
  expect((await app.rpc("todo.list", null)).some(todo => todo.id === original.id)).toBe(false);
}, 60_000);

});
