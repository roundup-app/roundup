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
  real = await startRealDaemon({ FAKE_CLAUDE_ORDER_PROMPTS: "2",
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "message_send", arguments: { to: "you", kind: "question", body: "goal?\n(1) a\n(2) b", replyTo: null } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u354 a question to you shows once and stops asking once answered, on the real Daemon", () => {
  it("u354_a_question_to_you_shows_one_answer_and_none_after_a_reply", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "new Workstream" }))[0]!);

    const rail = await screen.findByRole("region", { name: "rail" });

    fireEvent.click(await within(rail).findByRole("button", { name: /start Door/ }));

    const input = await screen.findByRole("textbox", { name: /^Tell .* sends$/ });

    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });
    fireEvent.input(input, { target: { value: "ask" } });
    fireEvent.click(await screen.findByRole("button", { name: "send" }));

    const thread = screen.getByRole("log", { name: "thread" });
    const card = await waitFor(() => thread.querySelector<HTMLElement>("[data-message-card=question]")!.closest("article")!, { timeout: 30_000 });

    const id = Number(card.getAttribute("data-message"));

    expect(thread.querySelectorAll(`[data-message="${id}"]`)).toHaveLength(1);
    expect(within(thread.querySelector<HTMLElement>(`[data-need="${id}"]`)!).getAllByRole("button", { name: "answer" })).toHaveLength(1);

    // U355: the question waits in `[data-needs]`, where `answer` is.
    fireEvent.click(within(thread.querySelector<HTMLElement>(`[data-need="${id}"]`)!).getByRole("button", { name: "answer" }));
    fireEvent.input(screen.getByRole("textbox", { name: /^Tell .* sends$/ }), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(thread.querySelector(`[data-message="${id}"] [data-answered]`)).not.toBeNull(), { timeout: 30_000 });
    expect(within(thread.querySelector<HTMLElement>(`[data-message="${id}"]`)!).queryByRole("button", { name: "answer" })).toBeNull();
    expect(thread.querySelectorAll(`[data-message="${id}"]`)).toHaveLength(1);
    await waitFor(async () => expect((await app.rpc("message.list", { to: null, status: null })).some((each) => each.body === "done" && each.replyTo === id)).toBe(true), { timeout: 30_000 });
  }, 120_000);
});
