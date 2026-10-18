// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => {
  real = await startRealDaemon({});
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

describe("u375 the user watches a Subagent on the real Daemon", () => {
  it("u375_typing_in_watch_reaches_nothing_and_a_takeover_reaches_the_terminal", async () => {
    const app: AppSeam = createServedApp(real.base);
    const emulators = fakeEmulators();

    await app.rpc("rail.createWorkstream", { name: "scope", parent: null });

    const door = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")!;
    const sub = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: door.id });
    const terminalId = (await app.rpc("rail.tree", null)).find((node) => node.id === sub.id)!.terminal_id!;
    const outputOf = async () => (await app.rpc("terminal.snapshot", { id: terminalId })).after;

    render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={emulators.factory} />);
    fireEvent.click(await screen.findByText(sub.name));
    await screen.findByText("Managed");

    const emulator = await waitFor(() => {
      const found = emulators.made.get(terminalId);

      if (!found) throw new Error("no emulator yet");

      return found;
    });

    const before = await outputOf();

    emulator.type(new TextEncoder().encode("watched\r"));
    await new Promise((done) => setTimeout(done, 500));
    expect(await outputOf()).toBe(before);

    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await screen.findByText("You control");
    emulator.type(new TextEncoder().encode("taken\r"));
    await waitFor(async () => expect(await outputOf()).toBeGreaterThan(before), { timeout: 15_000 });
  }, 120_000);
});
