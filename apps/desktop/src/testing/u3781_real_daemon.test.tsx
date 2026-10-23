// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { press } from "../switcher/switcherFixture";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon | undefined;

let folder: string | undefined;

afterEach(async () => {
  cleanup();
  await real?.stop();

  if (folder) await rm(folder, { recursive: true, force: true });
  real = undefined;
  folder = undefined;
});

/** The stock fake `claude`, except that its `Stop` hook waits while the file named by `U3781_HOLD` exists: the turn stays `working` until the test removes it. */
const HOLDING_CLAUDE = `#!/usr/bin/env python3
import os, runpy, subprocess, sys, time, json

run = subprocess.run

def held(command, *args, **options):
    if json.loads(options.get("input") or "{}").get("hook_event_name") == "Stop":
        while os.path.exists(os.environ["U3781_HOLD"]):
            time.sleep(0.02)
    return run(command, *args, **options)

subprocess.run = held
runpy.run_path(os.environ["U3781_FAKE"], run_name="__main__")
`;

describe("u3781 a note typed in the field reaches a real Agent once", () => {
  it("u3781_a_real_daemon_note_is_typed_once_at_idle", async () => {
    folder = await mkdtemp(join(tmpdir(), "u3781-"));
    const prompts = join(folder, "prompts.jsonl");
    const hold = join(folder, "hold");
    const claude = join(folder, "claude");

    await writeFile(claude, HOLDING_CLAUDE);
    await chmod(claude, 0o755);

    real = await startRealDaemon({
      FAKE_CLAUDE_PROMPT_LOG: prompts,
      ROUNDUP_CLAUDE_BIN: claude,
      U3781_FAKE: resolve(process.cwd(), "../../crates/rup/tests/e2e/fake_claude.py"),
      U3781_HOLD: hold,
    });

    const app: AppSeam = createServedApp(real.base);
    const calls = vi.spyOn(app, "rpc");
    const methods = (...names: string[]) => calls.mock.calls.map(([method]) => method).filter((method) => names.includes(method));
    const typed = async (body: string) => (await readFile(prompts, "utf8").catch(() => "")).split("\n").filter((line) => line.includes(body));
    const kind = async (id: string) => (await app.rpc("rail.tree", null)).find((node) => node.id === id)?.status?.kind;

    // The first turn is held, so the Agent is working while the notes are sent.
    await writeFile(hold, "");

    const agent = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Ann", order: { kind: "work", ask: "begin", limits: [] } });

    await waitFor(async () => expect(await kind(agent.id)).toBe("working"), { timeout: 60_000 });
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "Rail" });

    fireEvent.click(await waitFor(() => {
      const name = rail.querySelector<HTMLElement>(`.rail-row[data-id="${agent.id}"] .name`);

      expect(name).not.toBeNull();

      return name!;
    }, { timeout: 30_000 }));

    const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Note to Ann" });

    const note = (text: string, init: KeyboardEventInit) => {
      field.focus();
      fireEvent.input(field, { target: { value: text } });
      press("Enter", init, field);
    };

    // Enter queues: the Message waits, nothing is typed and no interrupt is called.
    note("enter note", {});
    await waitFor(() => expect(field.value).toBe(""));
    await waitFor(async () => expect((await app.rpc("message.list", { to: agent.id, status: null })).map((message) => [message.body, message.status])).toEqual([["enter note", "pending"]]));
    expect(await typed("enter note")).toEqual([]);
    expect(methods("message.send", "agent.interrupt")).toEqual(["message.send"]);

    await rm(hold);
    await waitFor(async () => expect(await typed("enter note")).toHaveLength(1), { timeout: 30_000 });
    await waitFor(async () => expect((await app.rpc("message.list", { to: agent.id, status: null }))[0]?.status).toBe("delivered"), { timeout: 30_000 });
    await waitFor(async () => expect(await kind(agent.id)).toBe("idle"), { timeout: 30_000 });
    expect(methods("agent.interrupt")).toEqual([]);

    // The next turn is held too; ⌘Enter sends, then interrupts, and the note is typed once at the idle that follows.
    await writeFile(hold, "");
    await app.rpc("agent.prompt", { id: agent.id, text: "again" });
    await waitFor(async () => expect(await kind(agent.id)).toBe("working"), { timeout: 30_000 });
    calls.mockClear();
    note("now note", { metaKey: true });
    await waitFor(() => expect(methods("message.send", "message.deliver", "agent.interrupt")).toEqual(["message.send", "agent.interrupt"]));
    expect(await typed("now note")).toEqual([]);

    await rm(hold);
    await waitFor(async () => expect(await typed("now note")).toHaveLength(1), { timeout: 30_000 });
    await waitFor(async () => expect(await kind(agent.id)).toBe("idle"), { timeout: 30_000 });
    expect(await typed("enter note")).toHaveLength(1);
    expect(await typed("now note")).toHaveLength(1);
    expect(methods("message.send", "agent.interrupt")).toEqual(["message.send", "agent.interrupt"]);
  }, 240_000);
});
