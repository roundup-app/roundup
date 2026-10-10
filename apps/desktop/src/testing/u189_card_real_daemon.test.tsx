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
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "message_send", arguments: { to: "you", kind: "question", body: "goal?\n(1) a\n(2) b", replyTo: null } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u189 a Door's question is a Card the user answers on the real Daemon", () => {
  it("u189_the_card_is_answered_from_the_thread_and_the_reply_names_the_question", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "new Workstream" }))[0]!);

    const rail = await screen.findByRole("region", { name: "rail" });

    fireEvent.click(await within(rail).findByRole("button", { name: /start Door/ }));

    const input = await screen.findByRole("textbox", { name: "message" });

    await waitFor(async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting"), { timeout: 30_000 });
    fireEvent.input(input, { target: { value: "ask" } });
    fireEvent.click(await screen.findByRole("button", { name: "send" }));

    const thread = screen.getByRole("log", { name: "thread" });
    const card = await waitFor(() => thread.querySelector<HTMLElement>("[data-message-card=question]")!.closest("article")!, { timeout: 30_000 });

    expect(card.querySelector(".thread-card-body")?.textContent?.split("\n")).toEqual(["goal?", "(1) a", "(2) b"]);

    const id = Number(card.getAttribute("data-message"));

    fireEvent.click(within(card).getByRole("button", { name: "answer" }));
    fireEvent.input(screen.getByRole("textbox", { name: "message" }), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(thread.querySelector(`[data-message="${id}"] [data-answered]`)).not.toBeNull(), { timeout: 30_000 });
    await waitFor(async () => expect((await app.rpc("message.list", { to: null, status: null })).some((each) => each.body === "done" && each.replyTo === id)).toBe(true), { timeout: 30_000 });
  }, 120_000);
});
