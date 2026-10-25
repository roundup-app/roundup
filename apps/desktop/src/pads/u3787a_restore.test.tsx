import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { AppSeam } from "../app/seam";
import { DrawerHost } from "../drawer/DrawerHost";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { padHandlers } from "../testing/stores";
import { openPad } from "./padsFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(["fake", "real"])("u3787a_generated_contract_restores_without_submitting_recovered_input_%s", async (kind) => {
  const real = kind === "real" ? await startRealDaemon({}) : null;
  const fake = createFakeApp();
  Object.assign(fake.handlers, padHandlers({ pads: [], history: [] }, () => {}));
  const app: AppSeam = real ? createServedApp(real.base) : fake;
  const connected = await connectProject(app, { name: "restore", path: real?.dir ?? "/restore" }, () => true, () => 0);

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
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(async () => expect((await app.rpc("pad.read", { name: "notes" })).text).toBe(text));
  } finally {
    cleanup();
    connected.stopTerminalScheme();
    await real?.stop();
  }
}, 120_000);
