// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { DrawerHost } from "../drawer/DrawerHost";
import { Pads } from "../pads/Pads";
import { createNow, DisplayClockContext } from "../state/clock";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { ToastHost } from "./toastHost";
import { createServedApp } from "./realSeam";
import { startRealDaemon, type StartedDaemon } from "./realDaemonFixture";

// Keep the real Daemon: the fake cannot show that its `pad.changed` and `pad.list` reach the read mark.
let real: StartedDaemon;

beforeAll(async () => { real = await startRealDaemon({}); }, 120_000);

afterAll(async () => { await real?.stop(); });

afterEach(() => { cleanup(); localStorage.clear(); });

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-shelf-row]")].map(row => row.getAttribute("data-pad"));

it("u7499b_an_agent_write_after_a_read_returns_the_pad_above_the_folds", async () => {
  const app = createServedApp(real.base);
  const connected = await connectProject(app, { name: "real", path: real.dir }, () => true, () => Date.now());

  const made = await app.rpc("pad.create", { name: "plan", text: "one", visibility: "shown" });
  render(() => {
    const now = createNow(() => 0, () => false);

    return <DisplayClockContext value={now.subscribe}><ToastHost><ConnectedProjectContext value={connected}><div class="shelf"><Pads /></div><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></ConnectedProjectContext></ToastHost></DisplayClockContext>;
  });

  // The user reads the Pad: it is in the idle fold until it is opened, then the Drawer leaves it.
  const idle = () => document.querySelector<HTMLButtonElement>('.pad-fold[data-fold="idle"]');

  await waitFor(() => expect(idle()).not.toBeNull(), { timeout: 20_000 });
  fireEvent.click(idle() ?? document.body);
  await waitFor(() => expect(document.querySelector('[data-pad="plan"] .pad-name')).not.toBeNull());
  fireEvent.dblClick(document.querySelector('[data-pad="plan"] .pad-name') ?? document.body);
  await waitFor(() => expect(connected.drawer.content()).not.toBeNull());
  connected.drawer.close();
  fireEvent.click(idle() ?? document.body);
  await waitFor(() => expect(rows()).toEqual([]));

  // The write that follows the read lists it above the folds.
  await app.rpc("pad.write", { name: "plan", text: "two", expectedIncarnation: made.incarnation, expectedRevision: made.revision });
  await waitFor(() => expect(rows()).toContain("plan"), { timeout: 20_000 });
}, 90_000);
