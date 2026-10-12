// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { chooseFromMenu } from "../thread/threadFixture";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

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

describe("u187 a Workstream's Door is talked to through its Thread on the real Daemon", () => {
  it("u187_thread_mode_hides_the_doors_terminal_and_a_takeover_types_into_it", async () => {
    const app: AppSeam = createServedApp(real.base);
    const { factory, made } = fakeEmulators();

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={factory} />);

    const rail = await screen.findByRole("region", { name: "rail" });
    const messages = async () => (await app.rpc("message.list", { to: null, status: null })).map((message) => message.body);
    const screenOf = () => document.querySelector<HTMLElement>(".pane-screen")!;

    fireEvent.click((await screen.findAllByRole("button", { name: /^(new Workstream|Add Workstream)$/ }))[0]!);
    fireEvent.click(await within(rail).findByRole("button", { name: /start Door/i }));
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });

    // Thread mode: the composer is the one text input in the centre and the Door's Terminal is not shown.
    const centre = screen.getByRole("log", { name: "thread" }).closest<HTMLElement>(".centre") ?? document.body;

    expect(screenOf().hidden).toBe(true);
    expect(within(centre).getAllByRole("textbox")).toHaveLength(1);

    fireEvent.input(await screen.findByRole("textbox", { name: /^Tell .* sends$/ }), { target: { value: "a" } });
    fireEvent.click(await screen.findByRole("button", { name: "send" }));
    await waitFor(async () => expect(await messages()).toContain("done a"), { timeout: 30_000 });
    await chooseFromMenu("All messages");
    await waitFor(() => expect(screen.getByRole("log", { name: "thread" }).textContent).toContain("done a"));

    // Takeover: the band, the Terminal and no composer; a typed line reaches the fake `claude`.
    await chooseFromMenu("Take over");
    await waitFor(() => expect(document.querySelector(".pane-takeover")?.textContent).toMatch(/^\s*Takeover: typing goes straight to /));

    expect(screenOf().hidden).toBe(false);
    expect(screen.queryByRole("textbox", { name: /^Tell .* sends$/ })).toBeNull();

    const [id] = [...made.keys()];

    made.get(id!)?.type(new TextEncoder().encode("z\r"));
    await waitFor(async () => expect(await messages()).toContain("done z"), { timeout: 30_000 });

    await chooseFromMenu("End takeover");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /^Tell .* sends$/ })).not.toBeNull());

    expect(screenOf().hidden).toBe(true);
    expect(document.querySelector(".pane-takeover")).toBeNull();
  }, 180_000);
});
