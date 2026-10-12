// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";
import { chooseFromMenu } from "../thread/threadFixture";

let real: StartedDaemon;

beforeAll(async () => {
  real = await startRealDaemon({
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "message_send", arguments: { to: "you", kind: "note", body: "done $prompt", replyTo: null } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u189 the Thread reads as a conversation on the real Daemon", () => {
  it("u189_three_messages_make_one_sender_line_per_run_no_delivered_and_ui_font_bodies", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "rail" });

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);
    fireEvent.click(await within(rail).findByRole("button", { name: /Start Door/i }));
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });

    await chooseFromMenu("All messages");

    for (const text of ["a", "b", "c"]) {
      fireEvent.input(await screen.findByRole("textbox", { name: /^Tell .* sends$/ }), { target: { value: text } });
      fireEvent.click(await screen.findByRole("button", { name: "send" }));
      await waitFor(() => expect(screen.getByRole("log", { name: "thread" }).textContent).toContain(`done ${text}`), { timeout: 30_000 });
    }

    const thread = screen.getByRole("log", { name: "thread" });
    const bodies = [...thread.querySelectorAll<HTMLElement>("[data-message-body]")];
    const runs = [...thread.querySelectorAll(".thread-run")];

    expect(bodies.length).toBeGreaterThanOrEqual(6);

    for (const run of runs) expect(run.querySelectorAll("[data-message-sender]")).toHaveLength(1);

    expect(thread.textContent).not.toContain("delivered");

    for (const body of bodies) expect(getComputedStyle(body).fontFamily).toBe("var(--font-ui)");
  }, 180_000);
});
