import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { showEverythingInApp } from "../testing/showEverything";
import { menuProbe, projectMenu } from "../testing/menuProbe";
import { Todos } from "../todos/Todos";
import { Pads } from "./Pads";
import type { ConnectedProject } from "../state/connectedProject";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppSeam } from "../app/seam";
import { DrawerHost } from "../drawer/DrawerHost";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon, type StartedDaemon } from "../testing/realDaemonFixture";
import { RpcError } from "../app/seam";
import { padHandlers } from "../testing/stores";
import { openPad } from "./padsFixture";

let real: StartedDaemon;

beforeAll(async () => { real = await startRealDaemon({}); }, 120_000);

afterAll(async () => { await real?.stop(); });

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(["fake", "real"])("u3787a_generated_contract_restores_without_submitting_recovered_input_%s", async (kind) => {
  const fake = createFakeApp();
  Object.assign(fake.handlers, padHandlers({ pads: [], history: [] }, () => {}));
  const app: AppSeam = kind === "real" ? createServedApp(real.base) : fake;
  const connected = await connectProject(app, { name: "restore", path: kind === "real" ? real.dir : "/restore" }, () => true, () => 0);

  try {
    const pad = await app.rpc("pad.create", { name: "notes", text: "original" });
    const destination = { surface: "pads", object: pad.incarnation, recipient: null };
    const text = "  pending é 🧭\n\nlast  ";
    const draft = connected.drafts.edit(destination, { originalName: pad.name, source: text, base: pad.text, baseRevision: pad.revision }, null, "ordinary").draft;
    const request = { name: pad.name, expectedIncarnation: pad.incarnation, operation: "unknown-reply" };
    await app.rpc("pad.delete", request);
    const receipt = await app.rpc("pad.getDeletion", { operation: request.operation });
    const restored = await app.rpc("pad.restore", { project: receipt.project, operation: receipt.operation });
    expect(restored.pad).toEqual(pad);
    render(() => <ConnectedProjectContext.Provider value={connected}><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></ConnectedProjectContext.Provider>);
    await openPad(pad.name, { connected, pads: [restored.pad], revision: draft.revision });
    expect(connected.drafts.list().find(item => item.revision === draft.revision)).toMatchObject({ destination, value: { source: text, originalName: "notes" } });
    expect(await app.rpc("pad.read", { name: "notes" })).toEqual(pad);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(async () => expect((await app.rpc("pad.read", { name: "notes" })).text).toBe(text));
  } finally {
    cleanup();
    connected.stopTerminalScheme();
  }
}, 120_000);

it("u3787a_app_and_fake_carry_the_original_operation_through_the_real_daemon", async () => {
  const app = createServedApp(real.base);
  const fake = createFakeApp();
  fake.handlers["rail.remove"] = params => app.rpc("rail.remove", params);
  fake.handlers["rail.deletion"] = params => app.rpc("rail.deletion", params);
  fake.handlers["rail.restore"] = params => app.rpc("rail.restore", params);
  const node = await app.rpc("rail.createWorkstream", { name: "retained", parent: null });
  const before = await app.rpc("rail.tree", null);
  const removed = await fake.rpc("rail.remove", { id: node.id, operation: "app-captured" });

  if (!removed?.deletion) throw new Error("the Daemon did not retain the chosen removal");

  expect(await app.rpc("rail.tree", null)).toEqual([]);
  expect(await fake.rpc("rail.deletion", removed.deletion)).toEqual(removed);
  const restored = await fake.rpc("rail.restore", removed.deletion);

  expect(restored.deletion?.restored).toBe(true);
  expect(await app.rpc("rail.tree", null)).toEqual(before);
  expect(await fake.rpc("rail.remove", { id: node.id, operation: "app-captured" })).toEqual(restored);
});

// U3787a names real identity/authority and receipt readback; helper-only mocks cannot prove redo.
it.each(["todos", "pads", "rail"] as const)("u3787a_retained_owner_redoes_the_exact_restored_operation_%s", async kind => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "redo", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;

  try {
    const chosen = await app.rpc("todo.create", { title: `chosen ${kind}`, body: null, blockers: null });
    const arrival = await app.rpc("todo.create", { title: `arrival ${kind}`, body: null, blockers: null });
    const pad = await app.rpc("pad.create", { name: `redo-${kind}`, text: "original é 🧭" });
    const node = await app.rpc("rail.createWorkstream", { name: `redo-${kind}`, parent: null });

    if (kind === "todos") await undo.remove([chosen.id, arrival.id + 1], kind);
    else if (kind === "pads") await undo.removePads([pad], kind);
    else await undo.removeRail(node.id, node.name, kind);

    const action = kind === "todos" ? "Delete Todo" : kind === "pads" ? "Delete Pad" : `Remove redo-${kind}`;
    expect(undo.undoLabel(kind)).toBe(`Undo ${action}`);
    expect(undo.undoLabel("empty")).toBe("Undo");
    await undo.undo(kind);
    expect(undo.undoLabel(kind)).toBe("Undo");
    expect(undo.redoLabel(kind)).toBe(`Redo ${action}`);
    expect(undo.redoLabel("empty")).toBe("Redo");
    const late = await app.rpc("todo.create", { title: `late ${kind}`, body: null, blockers: null });

    if (kind === "todos") expect(late.id).toBe(arrival.id + 1);
    // Redo consumes an acknowledged restoration, and another Undo consumes the new receipt.
    await undo.redo(kind);
    expect(undo.undoLabel(kind)).toBe(`Undo ${action}`);
    expect(undo.redoLabel(kind)).toBe("Redo");
    expect((await app.rpc("todo.list", null)).some(row => row.id === chosen.id)).toBe(kind !== "todos");
    expect((await app.rpc("pad.list", null)).some(row => row.incarnation === pad.incarnation)).toBe(kind !== "pads");
    expect((await app.rpc("rail.tree", null)).some(row => row.id === node.id)).toBe(kind !== "rail");
    expect((await app.rpc("todo.list", null)).filter(row => [arrival.id, late.id].includes(row.id)).map(row => row.id)).toEqual([arrival.id, late.id]);
    await undo.undo(kind);
    expect((await app.rpc("todo.list", null)).some(row => row.id === chosen.id)).toBe(true);
    expect(await app.rpc("pad.read", { name: pad.name })).toEqual(pad);
    expect((await app.rpc("rail.tree", null)).some(row => row.id === node.id)).toBe(true);
    expect(undo.failure()).toBe(null);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it.each(["todos", "pads", "rail"] as const)("u3787a_retained_owner_reconciles_unknown_redo_without_repeating_effects_%s", async kind => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "unknown redo", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;
  const requests: unknown[] = [];
  let readable = true;

  const bridge: AppSeam = { ...app, rpc: async (method, params) => {
    if (method === (kind === "todos" ? "todo.deletion" : kind === "pads" ? "pad.getDeletion" : "rail.deletion") && !readable) throw new Error("receipt unavailable");

    if (method === (kind === "todos" ? "todo.redo" : kind === "pads" ? "pad.redoDelete" : "rail.redo")) {
      requests.push(params);
      await app.rpc(method, params);
      readable = false;
      throw new Error("reply lost");
    }

    return app.rpc(method, params);
  } };

  try {
    const chosen = await app.rpc("todo.create", { title: `unknown ${kind}`, body: null, blockers: null });
    const node = await app.rpc("rail.createWorkstream", { name: `unknown ${kind}`, parent: null });
    const pad = await app.rpc("pad.create", { name: `unknown-${kind}`, text: "kept" });

    if (kind === "todos") await undo.remove([chosen.id]);
    else if (kind === "pads") await undo.removePads([pad]);
    else await undo.removeRail(node.id, node.name);

    await undo.undo();
    undo.reconnect(bridge);
    await undo.redo();
    expect(undo.failure()).toContain("receipt unavailable");
    expect(requests).toHaveLength(1);
    // Until readback settles, a new deletion must not erase this recoverable redo.
    expect(await undo.remove([chosen.id])).toBe(false);
    await undo.undo();
    readable = true;
    await undo.redo();
    expect(requests).toHaveLength(1);
    expect(undo.failure()).toBe(null);
    await undo.undo();
    expect((await app.rpc("todo.list", null)).some(row => row.id === chosen.id)).toBe(true);
    expect((await app.rpc("rail.tree", null)).some(row => row.id === node.id)).toBe(true);
    expect(await app.rpc("pad.read", { name: pad.name })).toEqual(pad);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it("u3787a_retained_redo_refusal_preserves_a_newer_home_and_retries_the_same_request", async () => {
  const app = createServedApp(real.base);
  const requests: unknown[] = [];

  const bridge: AppSeam = { ...app, rpc: (method, params) => {
    if (method === "todo.redo") requests.push(params);

    return app.rpc(method, params);
  } };

  const connected = await connectProject(bridge, { name: "refused redo", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;

  try {
    const chosen = await app.rpc("todo.create", { title: "moved since Undo", body: null, blockers: null });
    const home = await app.rpc("rail.createWorkstream", { name: "new user Home", parent: null });
    await undo.remove([chosen.id]);
    await undo.undo();
    await app.rpc("todo.move", { id: chosen.id, home: home.id });
    await undo.redo();
    expect(undo.failure()).not.toBe(null);
    expect((await app.rpc("todo.list", null)).find(row => row.id === chosen.id)?.home).toBe(home.id);
    await app.rpc("todo.move", { id: chosen.id, home: null });
    await undo.redo();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(undo.failure()).toBe(null);
    expect((await app.rpc("todo.list", null)).some(row => row.id === chosen.id)).toBe(false);
    await undo.undo();
    expect((await app.rpc("todo.list", null)).find(row => row.id === chosen.id)?.home).toBe(null);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it("u3787a_partial_pad_redo_retries_only_failed_members_as_one_undo_step", async () => {
  const app = createServedApp(real.base);
  const first = await app.rpc("pad.create", { name: "partial-redo-first", text: "first" });
  const second = await app.rpc("pad.create", { name: "partial-redo-second", text: "second" });
  const requests: unknown[] = [];
  let refuse = true;

  const bridge: AppSeam = { ...app, rpc: (method, params) => {
    if (method === "pad.redoDelete") {
      requests.push(params);

      if (refuse && params && "expectedIncarnation" in params && params.expectedIncarnation === second.incarnation) throw new RpcError(-32003, "Pad authority refused. Restore access and retry.");
    }

    return app.rpc(method, params);
  } };

  const connected = await connectProject(bridge, { name: "partial redo", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;

  try {
    await undo.removePads([first, second]);
    await undo.undo();
    await undo.redo();
    expect(undo.failure()).toContain("Pad authority refused");
    expect((await app.rpc("pad.list", null)).filter(pad => [first.incarnation, second.incarnation].includes(pad.incarnation)).map(pad => pad.incarnation)).toEqual([second.incarnation]);
    refuse = false;
    await undo.redo();
    expect(requests).toEqual([
      expect.objectContaining({ expectedIncarnation: first.incarnation }),
      expect.objectContaining({ expectedIncarnation: second.incarnation }),
      expect.objectContaining({ expectedIncarnation: second.incarnation }),
    ]);
    expect(requests[2]).toEqual(requests[1]);
    await undo.undo();
    expect(await app.rpc("pad.read", { name: first.name })).toEqual(first);
    expect(await app.rpc("pad.read", { name: second.name })).toEqual(second);
    expect(undo.available()).toBe(false);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it("u3787a_region_history_retains_order_and_clears_only_its_redo", async () => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "regions", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;

  try {
    const first = await app.rpc("todo.create", { title: "first regional Todo", body: null, blockers: null });
    const second = await app.rpc("todo.create", { title: "second regional Todo", body: null, blockers: null });
    const third = await app.rpc("todo.create", { title: "new regional branch", body: null, blockers: null });
    const pad = await app.rpc("pad.create", { name: "regional-pad", text: "keep this exact incarnation" });
    await undo.removeTodos([first.id], "todos");
    await undo.removePads([pad], "pads");
    await undo.remove([second.id], "todos");
    await undo.undo("todos");
    expect((await app.rpc("todo.list", null)).filter(row => [first.id, second.id].includes(row.id)).map(row => row.id)).toEqual([second.id]);
    expect((await app.rpc("pad.list", null)).some(row => row.incarnation === pad.incarnation)).toBe(false);
    await undo.undo("pads");
    await undo.remove([third.id], "todos");
    await undo.redo("todos");
    expect((await app.rpc("todo.list", null)).some(row => row.id === second.id)).toBe(true);
    await undo.redo("pads");
    expect((await app.rpc("pad.list", null)).some(row => row.incarnation === pad.incarnation)).toBe(false);
    await undo.undo("todos");
    expect((await app.rpc("todo.list", null)).filter(row => [first.id, second.id, third.id].includes(row.id)).map(row => row.id)).toEqual([second.id, third.id]);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it("u3787a_empty_region_does_not_use_another_history", async () => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "empty region", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;

  try {
    const todo = await app.rpc("todo.create", { title: "stay deleted", body: null, blockers: null });
    await undo.remove([todo.id], "todos");
    expect(undo.available("pads")).toBe(false);
    await undo.undo("pads");
    expect((await app.rpc("todo.list", null)).some(row => row.id === todo.id)).toBe(false);
    await undo.undo("todos");
    expect(undo.redoAvailable("pads")).toBe(false);
    await undo.redo("pads");
    expect((await app.rpc("todo.list", null)).some(row => row.id === todo.id)).toBe(true);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it("u3787a_unknown_delete_keeps_its_region_on_reconciliation", async () => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "regional retry", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;

  const bridge: AppSeam = { ...app, rpc: async (method, params) => {
    if (method === "todo.deletion") throw new Error("receipt unavailable");
    const result = await app.rpc(method, params);

    if (method === "todo.delete") throw new Error("acknowledgement lost");

    return result;
  } };

  try {
    const todo = await app.rpc("todo.create", { title: "regional unknown", body: null, blockers: null });
    undo.reconnect(bridge);
    await undo.remove([todo.id], `todo:${todo.id}`);
    expect(undo.uncertain()).toBe(true);
    undo.reconnect(app);
    await undo.retryDelete();
    expect(undo.available(`todo:${todo.id}`)).toBe(true);
    expect(undo.available("todos")).toBe(false);
    await undo.undo(`todo:${todo.id}`);
    expect((await app.rpc("todo.list", null)).find(row => row.id === todo.id)).toEqual(todo);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it.each(["todos", "pads"] as const)("u3787a_drawer_handoff_shares_one_operation_without_duplicate_restore_%s", async kind => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "handoff", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;
  let restores = 0;

  const bridge: AppSeam = { ...app, rpc: (method, params) => {
    if (method === (kind === "todos" ? "todo.restore" : "pad.restore")) restores++;

    return app.rpc(method, params);
  } };

  try {
    undo.reconnect(bridge);
    const todo = await app.rpc("todo.create", { title: "drawer handoff", body: null, blockers: null });
    const pad = await app.rpc("pad.create", { name: `handoff-${kind}`, text: "drawer source" });
    const region = kind === "todos" ? `todo:${todo.id}` : `pad:${pad.incarnation}`;

    if (kind === "todos") await undo.remove([todo.id], region);
    else await undo.removePads([pad], region);
    undo.handoff(region, "todos");
    undo.handoff(region, "todos");
    await undo.undo("todos");
    await undo.undo(region);
    expect(restores).toBe(1);

    if (kind === "todos") expect((await app.rpc("todo.list", null)).find(row => row.id === todo.id)).toEqual(todo);
    else expect(await app.rpc("pad.read", { name: pad.name })).toEqual(pad);
    await undo.redo(region);

    if (kind === "todos") expect((await app.rpc("todo.list", null)).some(row => row.id === todo.id)).toBe(false);
    else expect((await app.rpc("pad.list", null)).some(row => row.incarnation === pad.incarnation)).toBe(false);
    await undo.undo("todos");
    expect(restores).toBe(2);
    expect(undo.available(region)).toBe(false);
    expect(undo.available("todos")).toBe(false);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

it.each(["todos", "pads"] as const)("u3787a_handoff_redo_clears_only_the_destination_branch_%s", async kind => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "handoff branch", path: real.dir }, () => true, () => 0);
  const undo = connected.drafts.todoUndo;

  try {
    const todo = await app.rpc("todo.create", { title: "source branch", body: null, blockers: null });
    const next = await app.rpc("todo.create", { title: "destination branch", body: null, blockers: null });
    const pad = await app.rpc("pad.create", { name: `handoff-branch-${kind}`, text: "original" });
    const region = kind === "todos" ? `todo:${todo.id}` : `pad:${pad.incarnation}`;

    if (kind === "todos") await undo.remove([todo.id], region);
    else await undo.removePads([pad], region);
    undo.handoff(region, "shelf");
    await undo.undo("shelf");
    await undo.remove([next.id], "shelf");
    expect(undo.redoAvailable("shelf")).toBe(false);
    expect(undo.redoAvailable(region)).toBe(true);
    await undo.redo(region);
    await undo.undo("shelf");
    expect((await app.rpc("todo.list", null)).some(row => row.id === next.id)).toBe(true);

    if (kind === "todos") expect((await app.rpc("todo.list", null)).some(row => row.id === todo.id)).toBe(false);
    else expect((await app.rpc("pad.list", null)).some(row => row.incarnation === pad.incarnation)).toBe(false);
    expect(undo.available(region)).toBe(true);
    expect(undo.available("shelf")).toBe(false);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);

describe("U3787a connected App regions", () => {
  let real: StartedDaemon;

  beforeEach(async () => { real = await startRealDaemon({}); }, 120_000);
  afterEach(async () => { await real?.stop(); });

// The full App owns keys and native menu capture; the Daemon owns every mutation and identity.
it.each(["todos", "pads", "shelf-todos", "shelf-pads", "clear-done", "drawer-todo", "drawer-pad"])("u3787a_%s_delete_undo_redo_without_feedback", async kind => {
  const app = createServedApp(real.base);

  // The contract probes above retain their own data; each rendered region starts
  // with only its chosen item so a prior probe cannot supply its target or Home.
  for (const pad of await app.rpc("pad.list", null)) await app.rpc("pad.delete", { name: pad.name, expectedIncarnation: pad.incarnation, operation: `clean-${kind}-${pad.incarnation}` });

  const previous = await app.rpc("todo.list", null);

  if (previous.length) await app.rpc("todo.delete", { ids: previous.map(todo => todo.id), operation: `clean-${kind}-todos` });

  for (const node of await app.rpc("rail.tree", null)) await app.rpc("rail.remove", { id: node.id, operation: `clean-${kind}-${node.id}` });

  const name = `round-trip-${kind}`;
  const isPad = kind.includes("pad");
  const pad = isPad ? await app.rpc("pad.create", { name, text: "exact retained content" }) : null;
  const todo = !isPad ? await app.rpc("todo.create", { title: name, body: null, blockers: null }) : null;

  if (kind === "clear-done") await app.rpc("todo.complete", { id: todo!.id });
  let connected: ConnectedProject | undefined;
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} initialShelfOpen={kind !== "todos" && kind !== "pads"} createEmulator={fakeEmulators().factory} prepareIdle={open => { connected = open; open.showView("workstreams"); }} />);
  await waitFor(() => expect(connected !== undefined).toBe(true));
  await showEverythingInApp(undefined, isPad ? "Pads" : "Todos");

  if (kind === "todos" || kind === "pads") {
    connected!.rail.select(null);
    connected!.drawer.open(() => isPad ? <Pads /> : <Todos />, "key");
    await waitFor(() => {
      const controls = document.querySelectorAll<HTMLElement>('.drawer [data-shelf-group] [data-part="branch-control"]');
      expect(controls.length).toBeGreaterThan(0);

      for (const control of controls) if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(control);
    });
  }

  const owner = kind === "todos" || kind === "pads" ? within(screen.getByRole("complementary", { name: "Drawer" })) : screen;
  const row = kind === "clear-done" ? await screen.findByText("Clear done", { selector: "button" }) : isPad ? (await owner.findByText(name, { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")! : await owner.findByLabelText(new RegExp(`^(?:Idle|Blocked|Done) #${todo!.id} `));
  row.focus();

  if (kind.startsWith("drawer-")) {
    fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
    const panel = screen.getByRole("complementary", { name: "Drawer" });
    const button = await within(panel).findByRole("button", { name: isPad ? "Delete" : "Delete Todo" });
    button.focus(); fireEvent.click(button);
  } else if (kind === "clear-done") fireEvent.click(await screen.findByText("Clear done", { selector: "button" }));
  else if (kind === "todos" || kind === "pads") {
    const menus = menuProbe.count;
    fireEvent.contextMenu(row);
    await waitFor(() => expect(menuProbe.count).toBe(menus + 1));
    expect(menuProbe.shown?.some(item => item.id === "delete")).toBe(true);
    menuProbe.answer!("delete");
  } else fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  const read = async () => isPad ? (await app.rpc("pad.list", null)).some(item => item.incarnation === pad!.incarnation) : (await app.rpc("todo.list", null)).some(item => item.id === todo!.id);
  await waitFor(async () => expect(await read()).toBe(false));
  await waitFor(() => expect(connected!.drafts.todoUndo.pending()).toBe(false));
  // BulkDelete's acknowledged readback returns focus after its row refresh.
  const expectedRegion = kind === "todos" || kind === "pads" ? kind : "shelf";
  await waitFor(() => expect(document.activeElement?.closest<HTMLElement>("[data-history-region]")?.dataset.historyRegion).toBe(expectedRegion));

  const absent = () => {
    expect(document.querySelector(".todo-undo")).toBeNull();
    expect(screen.queryByText(/^Deleted(?:\s|·)/)).toBeNull();
    expect([...document.querySelectorAll("button")].filter(button => button.textContent === "Undo")).toEqual([]);
  };

  absent();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘Z")?.label).toBe(isPad ? "Undo Delete Pad" : "Undo Delete Todo"));
  fireEvent.keyDown(document.activeElement!, { key: "z", code: "KeyZ", metaKey: true });
  await waitFor(async () => expect(await read()).toBe(true));

  if (kind.startsWith("drawer-")) {
    if (isPad) {
      await waitFor(() => expect(document.querySelector('.shelf [data-shelf-group] [data-part="branch-control"]')).not.toBeNull());

      for (const control of document.querySelectorAll<HTMLElement>('.shelf [data-shelf-group] [data-part="branch-control"]')) {
        if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(control);
      }
    }

    const restoredRow = isPad ? (await screen.findByText(name, { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")! : await screen.findByLabelText(new RegExp(`^(?:Idle|Blocked|Done) #${todo!.id} `));
    restoredRow.focus();
    fireEvent.keyDown(restoredRow, { key: "Enter", code: "Enter" });
    const button = await within(screen.getByRole("complementary", { name: "Drawer" })).findByRole("button", { name: isPad ? "Delete" : "Delete Todo" });
    button.focus();
  }

  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⇧⌘Z")?.label).toBe(isPad ? "Redo Delete Pad" : "Redo Delete Todo"));
  absent();
  fireEvent.keyDown(document.activeElement!, { key: "z", code: "KeyZ", metaKey: true, shiftKey: true });
  await waitFor(async () => expect(await read()).toBe(false));
  absent();
});


it("u3787a_rail_delete_undo_redo_without_feedback", async () => {
  const app = createServedApp(real.base);
  const item = await app.rpc("rail.createWorkstream", { name: "round-trip-rail", parent: null });
  let connected: ConnectedProject | undefined;
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} prepareIdle={open => { connected = open; open.showView("workstreams"); }} />);
  const label = await screen.findByText("round-trip-rail", { selector: ".name" });
  const row = label.closest<HTMLElement>('[data-part="branch-control"]')!;
  fireEvent.click(row);
  await connected!.rail.settled();
  await waitFor(() => expect(connected!.rail.selected()).toBe(item.id));
  row.focus();
  fireEvent.keyDown(row, { key: "Backspace", code: "Backspace", metaKey: true });
  const present = async () => (await app.rpc("rail.tree", null)).some(node => node.id === item.id);
  await waitFor(async () => expect(await present()).toBe(false));
  await waitFor(() => expect(connected!.drafts.todoUndo.pending()).toBe(false));
  const rail = screen.getByRole("tree", { name: "Rail" });
  rail.tabIndex = -1; rail.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘Z")?.label).toBe("Undo Remove round-trip-rail"));
  expect([...document.querySelectorAll("button")].filter(button => ["Undo", "Dismiss"].includes(button.textContent ?? ""))).toEqual([]);
  fireEvent.keyDown(rail, { key: "z", code: "KeyZ", metaKey: true });
  await waitFor(async () => expect(await present()).toBe(true));
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⇧⌘Z")?.label).toBe("Redo Remove round-trip-rail"));
  fireEvent.keyDown(rail, { key: "z", code: "KeyZ", metaKey: true, shiftKey: true });
  await waitFor(async () => expect(await present()).toBe(false));
  expect([...document.querySelectorAll("button")].filter(button => ["Undo", "Dismiss"].includes(button.textContent ?? ""))).toEqual([]);
});

});
