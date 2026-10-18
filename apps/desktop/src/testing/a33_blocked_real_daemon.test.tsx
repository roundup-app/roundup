// @vitest-environment jsdom
import { rowStatusLabel } from "./rowTip";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp, spawnPrompted } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => {
  // E10: the first Agent that is not a Door hears its order and creates a blocker and a Todo waiting on it (A33); its Claude is the pinned one, its model aimock serving this file's turns.
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/a33_blocked.json"));
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("a33 an idle Agent that waits on an open blocker reads blocked, observed on the real Daemon", () => {
  it("a33_the_row_reads_blocked_with_its_waits_on_line_then_idle_when_the_blocker_completes", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "Rail" });
    const tree = async () => app.rpc("rail.tree", null);
    const agentNode = async () => (await tree()).find((node) => node.kind === "agent");

    fireEvent.click((await screen.findAllByRole("button", { name: /^\s*(New Workstream|Add Workstream)$/ }))[0]!);
    await waitFor(async () => expect((await tree()).filter((node) => node.kind === "workstream")).toHaveLength(1), { timeout: 30_000 });

    const workstream = (await tree()).find((node) => node.kind === "workstream")!.id;

    await waitFor(async () => {
      const start = within(rail).queryByRole("button", { name: /Start supervisor/i });

      if (start && !start.hasAttribute("disabled")) fireEvent.click(start);

      expect((await tree()).find((node) => node.id === workstream)?.status?.label).not.toBe("starting");
    }, { timeout: 30_000, interval: 1000 });

    await spawnPrompted(app, real.dir, workstream);
    await waitFor(async () => expect(await agentNode()).toBeTruthy(), { timeout: 30_000, interval: 1000 });

    const id = (await agentNode())!.id;

    // The Agent's own Stop makes it idle; its Todo waits on #1.
    const attempt = (await agentNode())!.attempt!;

    await app.rpc("agent.signal", { id, attempt, payload: { hook_event_name: "Stop" } });
    await waitFor(async () => expect((await agentNode())?.status?.kind).toBe("blocked"), { timeout: 60_000 });

    const row = (): HTMLElement => rail.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;

    await waitFor(() => expect(row().querySelector('.glyph[role="img"]')?.getAttribute("aria-label")).toBe("Blocked"));
    expect(await rowStatusLabel(row())).toBe("waits on #1");

    await app.rpc("todo.complete", { id: 1 });
    await waitFor(async () => expect((await agentNode())?.status?.kind).toBe("idle"), { timeout: 30_000 });
    await waitFor(() => expect(row().querySelector('.glyph[role="img"]')?.getAttribute("aria-label")).toBe("Idle"));
    await real.model!.assertMatched();
  }, 240_000);
});
