import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { AppSeam } from "../app/seam";
import { DrawerHost } from "../drawer/DrawerHost";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon, type StartedDaemon } from "../testing/realDaemonFixture";
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

    if (kind === "todos") await undo.remove([chosen.id]);
    else if (kind === "pads") await undo.removePads([pad]);
    else await undo.removeRail(node.id, node.name);

    await undo.undo();
    // Redo consumes an acknowledged restoration, and another Undo consumes the new receipt.
    await undo.redo();
    expect((await app.rpc("todo.list", null)).some(row => row.id === chosen.id)).toBe(kind !== "todos");
    expect((await app.rpc("pad.list", null)).some(row => row.incarnation === pad.incarnation)).toBe(kind !== "pads");
    expect((await app.rpc("rail.tree", null)).some(row => row.id === node.id)).toBe(kind !== "rail");
    expect((await app.rpc("todo.list", null)).some(row => row.id === arrival.id)).toBe(true);
    await undo.undo();
    expect((await app.rpc("todo.list", null)).some(row => row.id === chosen.id)).toBe(true);
    expect(await app.rpc("pad.read", { name: pad.name })).toEqual(pad);
    expect((await app.rpc("rail.tree", null)).some(row => row.id === node.id)).toBe(true);
    expect(undo.failure()).toBe(null);
  } finally { connected.stopTerminalScheme(); }
}, 120_000);
