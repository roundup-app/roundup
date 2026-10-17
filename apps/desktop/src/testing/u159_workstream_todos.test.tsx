// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => {
  // E10: the Door's Claude is the pinned one, its model aimock serving this file's turns.
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u159_door_todo.json"));
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u159 a Workstream's Todos are found from the Workstream on the real Daemon", () => {
  it("u159_the_todo_a_door_made_is_listed_by_this_workstream_and_another_workstream_has_none", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);

    const rail = await screen.findByRole("region", { name: "Rail" });

    fireEvent.click(await within(rail).findByRole("button", { name: /Start supervisor/i }));

    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });

    const workstream = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream");

    // U467: the user types to the Door in its Terminal; the Message is the same Daemon delivery without the keystrokes.
    await app.rpc("message.send", { to: workstream!.id, kind: "note", body: "ship j4", replyTo: null });

    await waitFor(async () => expect((await app.rpc("todo.list", null)).find((todo) => todo.title === "ship j4")?.home).toBe(workstream?.id), { timeout: 30_000 });

    const shelf = await screen.findByRole("region", { name: "Todos" });

    await screen.findByRole("button", { name: "Show all Workstreams" });
    await waitFor(() => expect([...shelf.querySelectorAll("[data-shelf-row]")].map((row) => row.textContent).join("\n")).toContain("ship j4"));

    // The Rail marks `New Workstream` aria-disabled while the selected Door is pending, and it drops a click then.
    const add = () => within(rail).getByRole("button", { name: /^\s*(New Workstream|Add Workstream)$/ });

    await waitFor(() => expect(add().getAttribute("aria-disabled")).not.toBe("true"), { timeout: 30_000 });
    fireEvent.click(add());
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).filter((node) => node.kind === "workstream")).toHaveLength(2), { timeout: 30_000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Show all Workstreams" }).getAttribute("aria-pressed")).toBe("false"));

    expect(await within(shelf).findByText(/No Todos in this Workstream/)).toBeTruthy();
    await real.model!.assertMatched();
  }, 120_000);
});
