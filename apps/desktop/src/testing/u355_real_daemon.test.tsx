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
  real = await startRealDaemon({
    FAKE_CLAUDE_ORDER_PROMPTS: "2",
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "checkpoint_write", arguments: { title: "Tests green", blocks: [{ kind: "rows", rows: [{ label: "build", value: "passes" }] }] } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u355 the Door's Thread shows a written Checkpoint on the real Daemon", () => {
  it("u355_a_door_writes_a_checkpoint_and_every_message_is_in_the_fold", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /^(new Workstream|Add Workstream)$/ }))[0]!);

    const rail = await screen.findByRole("region", { name: "rail" });

    fireEvent.click(await within(rail).findByRole("button", { name: /start Door/i }));

    const input = await screen.findByRole("textbox", { name: /^Tell .* sends$/ });

    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });
    fireEvent.input(input, { target: { value: "ask" } });
    fireEvent.click(await screen.findByRole("button", { name: "send" }));

    const card = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>("[data-checkpoints] [data-checkpoint]");

        if (found === null) throw new Error("no checkpoint yet");

        return found;
      },
      { timeout: 30_000 },
    );

    expect(card.textContent).toContain("Tests green");
    expect(card.querySelector("dd")?.textContent).toBe("passes");

    const messages = await app.rpc("message.list", { to: null, status: null });

    await waitFor(() => expect(document.querySelector(".thread-log-count")?.textContent).toBe(String(messages.length)));
    // SAFETY: widening the kind to string only compares it with a value the Message union lacks.
    expect(messages.every((each) => each.kind !== ("checkpoint" as string))).toBe(true);
  }, 120_000);
});
