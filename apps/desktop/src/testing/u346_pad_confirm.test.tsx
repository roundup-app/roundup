// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { showEverythingInApp } from "./showEverything";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { showShelfTab } from "./shelfTabs";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

// jsdom has no layout, so the editor's scroll-to-selection asks a Range for rects it cannot give.
Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => document.body.getBoundingClientRect();

let real: StartedDaemon;

const inFlight = new Set<Promise<unknown>>();

beforeEach(async () => {
  real = await startRealDaemon({});
}, 120_000);

afterEach(async () => {
  cleanup();
  await Promise.allSettled(inFlight);
  inFlight.clear();
  // The App's last pad.delete refresh may still be in flight; stopping the daemon under it rejects the fetch unhandled.
  await new Promise((done) => setTimeout(done, 250));
  await real?.stop();
});

describe("u346 the Pad's confirm delete takes a real click", () => {
  it("u346_a_pointer_click_on_the_confirm_calls_pad_delete_once_on_the_real_daemon", async () => {
    const app: AppSeam = createServedApp(real.base);
    const served = app.rpc;
    const calls: string[] = [];

    app.rpc = (method, params) => {
      calls.push(method);

      const call = served(method, params);

      // A request the App leaves in flight settles before the Daemon stops, and its late failure is not an unhandled rejection.
      inFlight.add(call);
      call.catch(() => {});

      return call;
    };

    await app.rpc("pad.create", { name: "plan", text: "v1" });
    calls.length = 0;
    await app.rpc("rail.createWorkstream", { name: "scope", parent: null });
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await showEverythingInApp(/scope/);

    const shelf = await screen.findByRole("region", { name: "Work items" });

    await within(shelf).findByRole("tablist", { name: "Work items" });
    showShelfTab("Pads");

    fireEvent.click(await within(shelf).findByRole("button", { name: "plan" }));

    const drawer = await screen.findByRole("complementary", { name: "Drawer" });

    fireEvent.click(await within(drawer).findByRole("button", { name: "Delete" }));

    const confirm = (await within(drawer).findAllByRole("button", { name: "Delete" }))[0]!;

    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fireEvent(confirm, new MouseEvent(type, { bubbles: true, cancelable: true }));

    await waitFor(() => expect(within(shelf).queryByRole("button", { name: "plan" })).toBeNull());
    expect(calls.filter((method) => method === "pad.delete")).toHaveLength(1);
  }, 120_000);
});
