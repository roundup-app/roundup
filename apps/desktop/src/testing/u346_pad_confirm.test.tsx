// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

// jsdom has no layout, so the editor's scroll-to-selection asks a Range for rects it cannot give.
Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => document.body.getBoundingClientRect();

let real: StartedDaemon;

beforeEach(async () => {
  real = await startRealDaemon({});
}, 120_000);

afterEach(async () => {
  cleanup();
  await real?.stop();
});

const rule = (css: string, selector: string) =>
  css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

describe("u346 the Pad's confirm delete takes a real click", () => {
  // jsdom has no layout, so `elementFromPoint` cannot be asked here; the cause was xterm's z-indexed layers in the centre painting over the Drawer, and the browser run (artifacts/ux/U346/) holds the hit test.
  it("u346_the_columns_keep_their_layers_under_the_drawer", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(rule(css, ".centre")).toContain("isolation: isolate");
    expect(rule(css, ".shelf")).toContain("isolation: isolate");
  });

  it("u346_a_pointer_click_on_the_confirm_calls_pad_delete_once_on_the_real_daemon", async () => {
    const app: AppSeam = createServedApp(real.base);
    const served = app.rpc;
    const calls: string[] = [];

    let closed = false;

    app.rpc = (method, params) => {
      calls.push(method);

      // A call still in flight when the daemon stops fails with `fetch failed`; nobody is left to read it.
      return served(method, params).catch((error: unknown) => (closed ? new Promise<never>(() => {}) : Promise.reject(error)));
    };

    await app.rpc("pad.create", { name: "plan", text: "v1" });
    calls.length = 0;
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const shelf = await screen.findByRole("region", { name: "shelf" });

    fireEvent.click(await within(shelf).findByRole("button", { name: "plan" }));

    const drawer = await screen.findByRole("complementary", { name: "drawer" });

    fireEvent.click(await within(drawer).findByRole("button", { name: "delete" }));

    const confirm = (await within(drawer).findAllByRole("button", { name: "delete" }))[0]!;

    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fireEvent(confirm, new MouseEvent(type, { bubbles: true, cancelable: true }));

    await waitFor(() => expect(within(shelf).queryByRole("button", { name: "plan" })).toBeNull());
    expect(calls.filter((method) => method === "pad.delete")).toHaveLength(1);
    cleanup();
    closed = true;
  }, 120_000);
});
