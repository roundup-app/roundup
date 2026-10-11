// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => {
  // Each prompt makes the Door write a Checkpoint through `rup mcp`, then the next prompt's note.
  real = await startRealDaemon({
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "checkpoint_write", arguments: { title: "checkpoint", blocks: [{ kind: "text", text: "done" }] } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u355 the Door's Thread reads as a timeline of checkpoints, on the real Daemon", () => {
  it("u355_a_checkpoint_written_by_the_door_appears_at_the_top_and_the_log_count_matches", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "rail" });

    fireEvent.click((await screen.findAllByRole("button", { name: "new Workstream" }))[0]!);
    fireEvent.click(await within(rail).findByRole("button", { name: /start Door/ }));
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });

    const count = () => document.querySelectorAll("[data-checkpoint]").length;

    for (const text of ["alpha", "bravo"]) {
      const before = count();

      fireEvent.input(await screen.findByRole("textbox", { name: /^Tell .* sends$/ }), { target: { value: text } });
      fireEvent.click(await screen.findByRole("button", { name: "send" }));
      await waitFor(() => expect(count()).toBeGreaterThan(before), { timeout: 30_000 });
    }

    // Each Message made the Door write one; the newest is the first card.
    const newest = [...document.querySelectorAll("[data-checkpoint]")].map((each) => Number(each.getAttribute("data-checkpoint")));

    expect(newest).toEqual(newest.toSorted((a, b) => b - a));

    const listed = (await app.rpc("message.list", { to: null, status: null })).length;

    expect(document.querySelector("[data-log] summary")!.textContent).toBe(`full log ${listed}`);
    expect(document.querySelector<HTMLDetailsElement>("[data-log]")!.open).toBe(false);
  }, 240_000);
});
