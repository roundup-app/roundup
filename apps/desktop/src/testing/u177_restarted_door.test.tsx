import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copy } from "./copy";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import { showShelfTab } from "./shelfTabs";
import { menuProbe } from "./menuProbe";
import type { StartedDaemon } from "./realDaemonFixture";

describe("u177 a stopped Door starts again on the real Daemon", () => {
  let real: StartedDaemon;

  beforeEach(async () => {
    // E10: the Door's Claude is the pinned one, its model aimock serving this file's turns.
    real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u177_restarted_door.json"));
  }, 120_000);

  afterEach(async () => {
    cleanup();
    await real?.stop();
  });

  const mount = () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    return app;
  };

  it("u177_start_door_after_a_daemon_restart_shows_the_door_idle_with_both_messages_delivered", async () => {
    const first = mount();
    await screen.findByRole("region", { name: copy.rail });

    const settled = (app: AppSeam) => async () => {
      const door = (await app.rpc("rail.tree", null)).find(node => node.kind === "workstream")!;

      expect(door.status?.kind).toBe("idle");
      expect((await app.rpc("terminal.screen", { id: door.terminal_id! })).lines.join("\n")).toContain("Ready for your instructions.");
    };

    const messages = async (app: AppSeam) => (await app.rpc("message.list", { to: null, status: null })).filter(message => message.from.kind === "user").map((message) => [message.body, message.status]);

    // U467: the user types to the Door in its Terminal; the Message is the same Daemon delivery without the keystrokes.
    const send = async (app: AppSeam, body: string) => {
      const workstream = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")!;

      await app.rpc("message.send", { to: workstream.id, kind: "note", body, replyTo: null });
    };

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);
    await waitFor(settled(first), { timeout: 30_000 });
    await send(first, "ship a");
    await waitFor(async () => expect(await messages(first)).toContainEqual(["ship a", "delivered"]), { timeout: 90_000 });
    await waitFor(async () => expect((await first.rpc("todo.list", null)).map((todo) => todo.title)).toContain("ship a"), { timeout: 30_000 });

    cleanup();
    await real.restart();

    const app = mount();
    const reopened = await screen.findByRole("region", { name: copy.rail });

    const workstream = (await app.rpc("rail.tree", null)).find(node => node.kind === "workstream")!;
    fireEvent.contextMenu(await within(reopened).findByText(workstream.name, { selector: ".rail-row .name" }));
    await waitFor(() => expect(menuProbe.shown?.some(item => item.id === "start" && item.enabled)).toBe(true));
    menuProbe.answer!("start");
    await waitFor(settled(app), { timeout: 30_000 });
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")?.status?.kind).toBe("idle"), { timeout: 30_000 });

    expect(within(reopened).queryByRole("button", { name: copy.retryDoor })).toBeNull();

    await send(app, "ship b");
    await waitFor(async () => expect(await messages(app)).toEqual([["ship a", "delivered"], ["ship b", "delivered"]]), { timeout: 90_000 });
    await waitFor(async () => expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toEqual(expect.arrayContaining(["ship a", "ship b"])), { timeout: 30_000 });

    fireEvent.click(document.querySelector("[data-todo-root]")!);
    showShelfTab(copy.todos);
    await waitFor(() => {
      const todos = Array.from(document.querySelectorAll("[data-todo]")).map((todo) => todo.textContent ?? "");

      expect(todos.some((text) => text.includes("ship a"))).toBe(true);
      expect(todos.some((text) => text.includes("ship b"))).toBe(true);
    });
    expect(within(reopened).queryByRole("button", { name: copy.retryDoor })).toBeNull();
    await real.model!.assertMatched();
  }, 60_000);
});

it("u4547b_creation_starts_with_the_saved_first_prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mode-input-"));
  const log = join(dir, "prompts.jsonl");
  const real = await startRealDaemon({ FAKE_CLAUDE_PROMPT_LOG: log, FAKE_CLAUDE_EXACT_PROMPTS: "1" });

  try {
    const app = createServedApp(real.base);
    const node = await app.rpc("rail.createWorkstream", { name: "Review", parent: null });
    const prompt = "  Review e\u0301 🧭\nKeep spacing  ";
    await app.rpc("workstream.setOpeningPrompt", { id: node.id, prompt });
    await app.rpc("workstream.restart", { id: node.id, request: "create-mode" });
    const inputs = async () => (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(entry => !entry.inbox);
    await waitFor(async () => expect(await inputs()).toEqual([{ resume: false, prompt }]), { timeout: 20_000 });
    await app.rpc("workstream.restart", { id: node.id, request: "create-mode" });
    expect(await inputs()).toEqual([{ resume: false, prompt }]);
    await app.rpc("workstream.setOpeningPrompt", { id: node.id, prompt: " changed for the next session\n " });
    expect(await inputs()).toEqual([{ resume: false, prompt }]);
  } finally { await real.stop(); await rm(dir, { recursive: true, force: true }); }
}, 180_000);

it("u4547c_saved_prompt_and_contents_survive_daemon_reopen", async () => {
  const real = await startRealDaemon({});

  try {
    const app = createServedApp(real.base);
    const node = await app.rpc("rail.createWorkstream", { name: "Review", parent: null });
    const child = await app.rpc("todo.create", { title: "Retained task", body: "", blockers: [] });
    await app.rpc("todo.move", { id: child.id, home: node.id });
    const prompt = "  exact first prompt\n ";
    await app.rpc("workstream.setOpeningPrompt", { id: node.id, prompt });
    await real.restart();
    const reopened = createServedApp(real.base);
    const tree = await reopened.rpc("rail.tree", null);
    expect(tree.find(row => row.id === node.id)).toMatchObject({ id: node.id, name: "Review", opening_prompt: prompt, terminal_id: null });
    expect((await reopened.rpc("todo.list", null)).find(row => row.id === child.id)).toMatchObject({ home: node.id, title: "Retained task" });
  } finally { await real.stop(); }
}, 180_000);
