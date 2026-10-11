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
  // The fake asks for a permission on every prompt, so the Door stays busy until the test answers.
  real = await startRealDaemon({
    FAKE_CLAUDE_ON_PROMPT_ASK: JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo $prompt" } }),
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u195 the Thread says what the Door works on and which Messages wait, on the real Daemon", () => {
  it("u195_queued_messages_and_the_door_line_follow_the_door_going_idle", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "rail" });

    fireEvent.click((await screen.findAllByRole("button", { name: "new Workstream" }))[0]!);
    fireEvent.click(await within(rail).findByRole("button", { name: /start Door/ }));
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });

    const words = () => [...document.querySelectorAll("[data-message-status]")].map((each) => each.textContent);
    const settled = async () => expect((await app.rpc("rail.tree", null)).find((node) => node.parent === null && node.kind === "agent")?.status?.kind).not.toBe("working");

    // The Door's first prompt (its own order) asks for a Decision and keeps it busy.
    await waitFor(async () => expect((await app.rpc("decision.list", null)).length).toBeGreaterThan(0), { timeout: 60_000 });

    for (const text of ["one", "two"]) {
      fireEvent.input(await screen.findByRole("textbox", { name: /^Tell .* sends$/ }), { target: { value: text } });
      fireEvent.click(await screen.findByRole("button", { name: "send" }));
      await waitFor(() => expect(screen.getByRole("log", { name: "thread" }).textContent).toContain(text), { timeout: 30_000 });
    }

    await waitFor(() => expect(words()).toEqual(["queued", "queued"]), { timeout: 30_000 });
    expect(document.querySelectorAll("[data-now]").length).toBeGreaterThanOrEqual(1);

    // The Door goes idle once every Decision is allowed; the Messages are then taken up, one after the other.
    const pump = setInterval(async () => {
      try {
        for (const decision of await app.rpc("decision.list", null)) await app.rpc("decision.answer", { id: decision.id, answer: "allow", proof: await app.daemonProof() });
      } catch {
        // The Daemon or the App is gone; the test has ended.
      }
    }, 300);

    try {
      await waitFor(() => expect(words()).not.toContain("queued"), { timeout: 90_000 });
      await waitFor(settled, { timeout: 90_000 });
      await waitFor(() => expect(document.querySelectorAll("[data-message-taken]")).toHaveLength(0), { timeout: 30_000 });
    } finally {
      clearInterval(pump);
    }
  }, 240_000);
});
