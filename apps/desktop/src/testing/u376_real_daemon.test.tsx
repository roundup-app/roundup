// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

beforeAll(async () => {
  // The first Agent that is not a Door asks the Agent that started it a question.
  real = await startRealDaemon({
    FAKE_CLAUDE_AGENT_TOOLS: JSON.stringify([
      { name: "agent_context", arguments: {} },
      { name: "message_send", arguments: { to: "$ask", kind: "question", body: "which file?\nthe old or the new" } },
    ]),
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }),
    FAKE_CLAUDE_KINDS: JSON.stringify(["needs-you"]),
    FAKE_CLAUDE_AGENT_REPORT: join(mkdtempSync(join(tmpdir(), "u376-")), "report.json"),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u376 the Door's Thread shows a Subagent's question and the user answers it, on the real Daemon", () => {
  it("u376_a_subagents_question_shows_and_its_answer_reaches_its_terminal_without_a_takeover", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "rail" });
    const tree = async () => app.rpc("rail.tree", null);
    const agentNode = async () => (await tree()).find((node) => node.kind === "agent" && node.parent !== null);

    fireEvent.click((await screen.findAllByRole("button", { name: /^\s*new Workstream$/ }))[0]!);
    await waitFor(async () => expect((await tree()).filter((node) => node.kind === "workstream")).toHaveLength(1), { timeout: 30_000 });

    const workstream = (await tree()).find((node) => node.kind === "workstream")!.id;

    await waitFor(async () => {
      const start = within(rail).queryByRole("button", { name: /start Door/ });

      if (start && !start.hasAttribute("disabled")) fireEvent.click(start);

      expect((await tree()).find((node) => node.id === workstream)?.status?.label).not.toBe("starting");
    }, { timeout: 30_000, interval: 1000 });

    await waitFor(async () => {
      if (!(await agentNode())) fireEvent.click(await within(rail).findByRole("treeitem", { name: /^\s*agent$/ }));

      expect(await agentNode()).toBeTruthy();
    }, { timeout: 30_000, interval: 1000 });

    await waitFor(async () => expect((await app.rpc("message.list", { to: null, status: null })).some((each) => each.kind === "question")).toBe(true), { timeout: 60_000 });

    fireEvent.click(rail.querySelector<HTMLElement>(`[role="treeitem"][data-id="${workstream}"]`)!);
    await waitFor(async () => expect((await agentNode())?.status?.kind).toBe("needs-you"), { timeout: 60_000 });

    const reply = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>("[data-reply]");

        if (found === null) throw new Error("no reply yet");

        return found;
      },
      { timeout: 60_000 },
    );

    expect(reply.textContent).toContain("the old or the new");

    fireEvent.input(within(reply).getByLabelText("answer"), { target: { value: "the new one" } });
    fireEvent.click(within(reply).getByRole("button", { name: "answer" }));

    await waitFor(() => expect(document.querySelector("[data-reply] [data-reply-answered]")).not.toBeNull(), { timeout: 30_000 });

    // B1: the note is queued while the Subagent waits on its Decision, and reaches its Terminal once the user allows it.
    for (const decision of await app.rpc("decision.list", null)) await app.rpc("decision.answer", { id: decision.id, answer: "allow", proof: await app.daemonProof() });

    const stopped = (await agentNode())!;

    await app.rpc("agent.signal", { id: stopped.id, attempt: stopped.attempt!, payload: { hook_event_name: "Stop" } });

    const terminal = (await agentNode())!.terminal_id!;

    await waitFor(async () => expect(Buffer.from((await app.rpc("terminal.snapshot", { id: terminal })).data, "base64").toString()).toContain("the new one"), { timeout: 30_000 });
  }, 240_000);
});
