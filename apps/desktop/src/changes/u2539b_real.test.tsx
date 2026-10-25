import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { App } from "../App";
import { startWorktreeProject } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { fakeEmulators } from "../terminal/paneHarness";
import { openProjectPage } from "../testing/menuProbe";
import type { ConnectedProject } from "../state/connectedProject";

it("u2539b_real_daemon_ask_attention_and_review_use_requested_surfaces", async () => {
  const logs = mkdtempSync(join(tmpdir(), "u2539b-vendor-"));

  const real = await startWorktreeProject({ "base.txt": "base\n" }, {
    FAKE_CLAUDE_PROMPT_LOG: join(logs, "prompts.jsonl"),
    FAKE_CLAUDE_RUN_REPORT: join(logs, "commands.json"),
    FAKE_CLAUDE_RUN: JSON.stringify([["sh", "-c", "printf 'made by the fake vendor\\n' > result.txt"]]),
  });

  try {
    const app = createServedApp(real.base);
    const home = await app.rpc("rail.createWorkstream", { name: "Work", parent: null });
    let connected: ConnectedProject | undefined;
    const emulators = fakeEmulators();
    render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={emulators.factory} prepareIdle={open => { connected = open; }} />);
    const input = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
    input.focus();
    fireEvent.input(input, { target: { value: "@Work inspect the result" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(async () => expect((await app.rpc("ask.list", null))[0]?.text).toBe("@Work inspect the result"));
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).find(node => node.id === home.id)?.status?.kind).toBe("idle"));
    const maker = (await app.rpc("rail.tree", null)).find(node => node.id === home.id)!;
    // The fake vendor speaks the same public hook command as its settings file.
    // This creates real Daemon native attention, rather than a fake webview event.
    execFileSync(resolve("../../target/debug/rup"), ["signal", maker.id], {
      input: JSON.stringify({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "inspect result.txt" } }),
      env: { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock"), ROUNDUP_ATTEMPT: maker.attempt! },
      timeout: 5_000,
    });
    await waitFor(() => expect(document.querySelectorAll(".overview-entry")).toHaveLength(1));
    fireEvent.click(document.querySelector<HTMLButtonElement>(".overview-entry")!);
    await waitFor(() => expect(connected?.rail.selected()).toBe(maker.id));
    await waitFor(() => expect(emulators.made.has(maker.terminal_id!)).toBe(true));
    const terminal = emulators.made.get(maker.terminal_id!);
    const opener = await screen.findByRole("button", { name: maker.worktree!.branch });
    fireEvent.click(opener);
    await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Worktree" }), { key: "Escape", code: "Escape" });
    openProjectPage("view:workstreams", real.dir);
    openProjectPage("view:workstreams", real.dir);
    fireEvent.click(await screen.findByRole("button", { name: maker.worktree!.branch }));
    await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
    expect(emulators.made.get(maker.terminal_id!)).toBe(terminal);
    expect((await app.rpc("agent.changedFiles", { id: maker.id })).files.map(file => file.path)).toContain("result.txt");
  } finally {
    cleanup();
    await real.stop();
    rmSync(logs, { recursive: true, force: true });
  }
}, 60_000);
