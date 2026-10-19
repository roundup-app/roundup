// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeEach(async () => {
  // E10: the Door's Claude is the pinned one, its model aimock serving this file's turns.
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u177_restarted_door.json"));
}, 120_000);

afterEach(async () => {
  cleanup();
  await real?.stop();
});

const mount = () => {
  const app: AppSeam = createServedApp(real.base);

  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  return app;
};

describe("u177 a stopped Door starts again on the real Daemon", () => {
  it("u177_start_door_after_a_daemon_restart_shows_the_door_idle_with_both_messages_delivered", async () => {
    const first = mount();
    const rail = await screen.findByRole("region", { name: "Rail" });
    const settled = (app: AppSeam) => async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting");
    const messages = async (app: AppSeam) => (await app.rpc("message.list", { to: null, status: null })).map((message) => [message.body, message.status]);

    // U467: the user types to the Door in its Terminal; the Message is the same Daemon delivery without the keystrokes.
    const send = async (app: AppSeam, body: string) => {
      const workstream = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")!;

      await app.rpc("message.send", { to: workstream.id, kind: "note", body, replyTo: null });
    };

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);
    fireEvent.click(await within(rail).findByRole("button", { name: /Start supervisor/i }));
    await waitFor(settled(first), { timeout: 30_000 });
    await send(first, "ship a");
    await waitFor(async () => expect(await messages(first)).toContainEqual(["ship a", "delivered"]), { timeout: 90_000 });
    await waitFor(async () => expect((await first.rpc("todo.list", null)).map((todo) => todo.title)).toContain("ship a"), { timeout: 30_000 });

    cleanup();
    await real.restart();

    const app = mount();
    const reopened = await screen.findByRole("region", { name: "Rail" });

    fireEvent.click(await within(reopened).findByRole("button", { name: /Start supervisor/i }, { timeout: 30_000 }));
    await waitFor(settled(app), { timeout: 30_000 });
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")?.status?.kind).toBe("idle"), { timeout: 30_000 });
    const workstream = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")!;

    await waitFor(() => expect(reopened.querySelector(`.rail-row[data-id="${workstream.id}"]`)?.getAttribute("data-kind")).toBe("idle"), { timeout: 30_000 });
    expect(within(reopened).queryByRole("button", { name: /Retry supervisor/i })).toBeNull();

    await send(app, "ship b");
    await waitFor(async () => expect(await messages(app)).toEqual([["ship a", "delivered"], ["ship b", "delivered"]]), { timeout: 90_000 });
    await waitFor(async () => expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toEqual(expect.arrayContaining(["ship a", "ship b"])), { timeout: 30_000 });

    fireEvent.click(document.querySelector("[data-todo-root]")!);
    await waitFor(() => {
      const todos = Array.from(document.querySelectorAll("[data-todo]")).map((todo) => todo.textContent ?? "");

      expect(todos.some((text) => text.includes("ship a"))).toBe(true);
      expect(todos.some((text) => text.includes("ship b"))).toBe(true);
    });
    expect(within(reopened).queryByRole("button", { name: /Retry supervisor/i })).toBeNull();
    await real.model!.assertMatched();
  }, 300_000);
});
