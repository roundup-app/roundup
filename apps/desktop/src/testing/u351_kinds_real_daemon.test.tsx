// @vitest-environment jsdom
import { rowStatusLabel } from "./rowTip";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Status } from "@contracts/Status";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

const stop = (child: ChildProcess) => new Promise<void>((done) => {
  if (child.exitCode !== null || child.signalCode !== null) return done();
  child.once("exit", () => done());
  child.kill();
});

const doorReady = async (statusOf: () => Promise<Status | null | undefined>, row: () => HTMLElement) => {
  // SessionStart/Stop publish Idle (claude_code/mod.rs); Working can still be the startup prompt.
  await waitFor(async () => {
    const status = await statusOf();

    expect(status?.kind).toBe("idle");
    expect(status?.label).toBe("idle");
    expect(row().getAttribute("data-kind")).toBe(status?.kind);
  });
};

const kindReady = async (statusOf: () => Promise<Status | null | undefined>, context: { workstream: string; agent: string; expected: string }, claims: string, timeout = 60_000) => {
  let status: Status | null | undefined;

  try {
    await waitFor(async () => {
      status = await statusOf();
      expect(status?.label).not.toBe("starting");
      expect(status?.kind).toBe(context.expected);
    }, { timeout });
  } catch (failure) {
    const records = await readFile(claims, "utf8").then((text) => text, (error: Error) => `Kind claim records unavailable: ${String(error)}`);

    console.error("U482 Kind wait failed", { ...context, status }, records);
    throw failure;
  }
};

it("u482_kind_wait_failure_reports_claims_and_preserves_the_assertion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "u482-report-"));
  const claims = join(dir, "claims.jsonl");
  const record = '{"index":0,"kind":"error","pid":123,"ppid":122,"argv":["claude"]}\n';
  const status: Status = { kind: "error", label: "u351", since: 1 };
  const context = { workstream: "workstream-1", agent: "agent-1", expected: "working" };
  const output = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    await writeFile(claims, record);

    for (const path of [claims, join(dir, "missing"), dir]) {
      await expect(kindReady(async () => status, context, path, 20)).rejects.toThrow("expected 'error' to be 'working'");
      expect(output).toHaveBeenLastCalledWith("U482 Kind wait failed", { ...context, status }, path === claims ? record : expect.stringContaining("Kind claim records unavailable:"));
    }
  } finally {
    output.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

// U482 exercises the executable, so concurrent claims include the filesystem boundary.
it("u482_claims_identify_each_launch_without_duplicate_entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "u482-"));
  const settings = join(dir, "settings.json");
  const hooks = Object.fromEntries(["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "PermissionRequest"].map((event) => [event, [{ hooks: [{ command: "true" }] }]]));

  await writeFile(settings, JSON.stringify({ hooks }));
  const executable = resolve("../../crates/rup/tests/e2e/fake_claude.py");

  const launch = (door: boolean) => spawn(executable, ["--settings", settings, ...(door ? ["--tools", ""] : [])], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, FAKE_CLAUDE_KINDS: '["working","idle","error","needs-you"]', FAKE_CLAUDE_ON_PROMPT: "[]" },
    stdio: "pipe",
  });

  const door = launch(true);
  let doorReady = false;

  door.stdout.on("data", () => { doorReady = true; });
  const children = Array.from({ length: 7 }, () => launch(false));

  try {
    await waitFor(async () => {
      const records = (await readFile(join(dir, "fake-claude-kind-claims.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));

      expect(doorReady).toBe(true);
      expect(records).toHaveLength(7);
      expect(records.filter((record) => record.index !== null).sort((a, b) => a.index - b.index).map((record) => record.kind)).toEqual(["working", "idle", "error", "needs-you"]);
      expect(records.filter((record) => record.index !== null).map((record) => record.index).sort()).toEqual([0, 1, 2, 3]);
      expect(records.filter((record) => record.index === null)).toHaveLength(3);
      expect(new Set(records.map((record) => record.pid))).toEqual(new Set(children.map((child) => child.pid)));
      expect(records.some((record) => record.pid === door.pid)).toBe(false);

      for (const record of records) {
        expect(record.ppid).toBe(process.pid);
        expect(record.argv).toEqual([executable, "--settings", settings]);

        if (record.index === null) expect(record.kind).toBeNull();
      }
    }, { timeout: 10_000 });
  } finally {
    await Promise.all([door, ...children].map(stop));
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

it("u482_kind_launch_acknowledges_the_typed_startup_prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "u482-startup-"));
  const settings = join(dir, "settings.json");
  const events = join(dir, "hooks.jsonl");
  const command = `python3 -c 'import os,sys; open(os.environ["U482_HOOK_LOG"], "a").write(sys.stdin.read()+"\\n")'`;
  const hooks = Object.fromEntries(["SessionStart", "UserPromptSubmit"].map((event) => [event, [{ hooks: [{ command }] }]]));

  await writeFile(settings, JSON.stringify({ hooks }));

  const child = spawn(resolve("../../crates/rup/tests/e2e/fake_claude.py"), ["--settings", settings], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, FAKE_CLAUDE_KINDS: '["working"]', U482_HOOK_LOG: events },
    stdio: "pipe",
  });

  const observed = async () => (await readFile(events, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

  try {
    await waitFor(async () => expect((await observed())[0]?.hook_event_name).toBe("SessionStart"), { timeout: 10_000 });
    // H12 acknowledges the bytes actually submitted, not an invented startup prompt.
    child.stdin.write("build deterministic startup\n");
    await waitFor(async () => {
      const submitted = (await observed()).filter((event) => event.hook_event_name === "UserPromptSubmit");

      expect(submitted.map((event) => event.prompt)).toEqual(["build deterministic startup"]);
    }, { timeout: 10_000 });
  } finally {
    await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

let real: StartedDaemon;

// Two Workstreams of five Agents each; the Nth Agent started plays entry N (U351).
const FIRST = ["working", "idle", "needs-you", "working", "idle"];

const SECOND = ["error", "needs-you", "working", "error", "needs-you"];

describe("u351 the fake claude holds each Agent in a Kind, observed on the real Daemon", () => {
  beforeAll(async () => {
    // A Door has `--tools`, plays no entry and is ready after its SessionStart, which FAKE_CLAUDE_ON_PROMPT plays.
    real = await startRealDaemon({
      FAKE_CLAUDE_KINDS: JSON.stringify([...FIRST, ...SECOND]),
      FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }),
    });
    real.daemon.stderr!.on("data", (chunk: Buffer) => console.error("U482 Daemon", real.daemon.pid, chunk.toString()));
  }, 120_000);

  afterAll(async () => {
    await real?.stop();
  });

  afterEach(cleanup);

  it("u351_door_readiness_survives_working_to_idle_before_the_rail_renders", async () => {
    const row = document.createElement("div");
    let observations = 0;

    await doorReady(async () => {
      observations += 1;
      // The RPC observes Working; the subscription publishes Idle before the Rail draws.
      row.setAttribute("data-kind", "idle");

      return { kind: observations === 1 ? "working" : "idle", label: observations === 1 ? "working" : "idle", since: observations };
    }, () => row);
    expect(observations).toBeGreaterThan(1);
    expect(row.getAttribute("data-kind")).toBe("idle");
  });

  it("u351_ten_agents_read_their_kinds_the_jump_visits_error_then_needs_you_and_working_is_quiet", async () => {
    const app: AppSeam = createServedApp(real.base);
    const rpc = app.rpc;

    app.rpc = async (method, params) => {
      if (method === "agent.spawn" || method === "rail.startDoor") console.error("U482 launch request", method, params);
      const result = await rpc(method, params);

      if (method === "agent.spawn" || method === "rail.startDoor") console.error("U482 launch reply", method, result);

      return result;
    };

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "Rail" });
    const tree = async () => app.rpc("rail.tree", null);
    const agentsOf = async (workstream: string) => (await tree()).filter((node) => node.kind === "agent" && node.parent === workstream);
    const doorsReady = async () => expect((await tree()).map((node) => node.status?.label)).not.toContain("starting");
    const selected = () => rail.querySelector('.rail-row[data-selected="true"]')?.getAttribute("data-id") ?? null;

    const row = (id: string): HTMLElement => {
      const found = rail.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`);

      if (!found) throw new Error(`no row ${id}`);

      return found;
    };

    const workstreams: string[] = [];
    const agents: { id: string; kind: string }[] = [];

    for (const kinds of [FIRST, SECOND]) {
      const known = (await tree()).filter((node) => node.kind === "workstream").map((node) => node.id);

      fireEvent.click((await screen.findAllByRole("button", { name: /^\s*(New Workstream|Add Workstream)$/ }))[0]!);
      await waitFor(async () => expect((await tree()).filter((node) => node.kind === "workstream")).toHaveLength(known.length + 1), { timeout: 30_000 });

      const workstream = (await tree()).find((node) => node.kind === "workstream" && !known.includes(node.id))!.id;

      workstreams.push(workstream);
      await waitFor(() => expect(row(workstream)).toBeTruthy());
      // The Door's button shows only while it has not started, so press it until the Door is not "starting" or gone.
      await waitFor(async () => {
        const start = within(rail).queryByRole("button", { name: /Start supervisor/i });

        if (start && !start.hasAttribute("disabled")) fireEvent.click(start);

        expect((await tree()).find((node) => node.id === workstream)?.status?.label).not.toBe("starting");
        await doorsReady();
      }, { timeout: 30_000, interval: 1000 });

      await doorReady(async () => (await tree()).find((node) => node.id === workstream)?.status, () => row(workstream));

      for (const [at, kind] of kinds.entries()) {
        // A press while the last start is still pending calls nothing (U9), so press again until the Agent is in the tree.
        await waitFor(async () => {
          if ((await agentsOf(workstream)).length <= at) fireEvent.click(await within(rail.querySelector<HTMLElement>(`[data-id="${workstream}"]`)!).findByLabelText("Add Agent"));

          expect(await agentsOf(workstream)).toHaveLength(at + 1);
        }, { timeout: 30_000, interval: 1000 });

        const born = (await agentsOf(workstream)).find((node) => !agents.some((each) => each.id === node.id))!;

        // The Adapter starts at Working/starting (claude_code/mod.rs); the fake program claims its Kind before it publishes any later label. Wait for that publication before launching the next program.
        await kindReady(async () => (await tree()).find((node) => node.id === born.id)?.status,
          { workstream, agent: born.id, expected: kind }, join(real.dir, "claude-config", "fake-claude-kind-claims.jsonl"));
        // The RPC reply can precede the subscription that renders the Rail row.
        await waitFor(() => expect(row(born.id).querySelector('.glyph[role="img"]')?.getAttribute("aria-label")).toBe(kind[0]!.toUpperCase() + kind.slice(1)));
        agents.push({ id: born.id, kind });
      }
    }

    // Observed: every row's glyph and Status word agree with its entry, not by colour alone.
    for (const { id, kind } of agents) {
      // The tree answers before the Rail draws the row, so wait for it.
      await waitFor(() => expect(row(id)).toBeTruthy());
      fireEvent.click(row(id).querySelector(".name")!);
      await waitFor(() => expect(selected()).toBe(id));

      const node = (await tree()).find((each) => each.id === id);

      await waitFor(async () => expect(await rowStatusLabel(row(id))).toBe(node?.status?.label));

      const glyph = row(id).querySelector('.glyph[role="img"]');
      const word = await rowStatusLabel(row(id));
      expect(glyph?.getAttribute("aria-label")).toBe(kind[0]!.toUpperCase() + kind.slice(1));
      expect(word).toBe(node?.status?.label);
      expect(word.length).toBeGreaterThan(0);
    }

    const kindOf = async (id: string) => (await tree()).find((node) => node.id === id)?.status?.kind;

    // U403: a collapsed Workstream row leads its Agent Glyphs with the most urgent Kind of its Agents.
    for (const [workstream, kind] of [[workstreams[0]!, "needs-you"], [workstreams[1]!, "error"]] as const) {
      fireEvent.click(row(workstream).querySelector('button[aria-label="Collapse"]')!);
      await waitFor(() => expect(row(workstream).querySelector('.folded-agents .glyph[role="img"]')?.getAttribute("aria-label")).toBe(kind[0]!.toUpperCase() + kind.slice(1)));
      fireEvent.click(row(workstream).querySelector('button[aria-label="Collapse"]')!);
      await waitFor(() => expect(row(agents[0]!.id)).toBeTruthy());
    }

    // Quiet: a working Agent opens no Decision Card and the selection stays.
    const working = agents.find((each) => each.kind === "working")!.id;

    fireEvent.click(row(working).querySelector(".name")!);
    await waitFor(() => expect(selected()).toBe(working));
    await new Promise((done) => setTimeout(done, 1500));
    expect(selected()).toBe(working);
    expect(screen.queryByRole("region", { name: /Decision for/ })).toBeNull();
    expect(await kindOf(working)).toBe("working");

    // Jump: `error` before `needs-you`, oldest first, across both Workstreams, then it wraps.
    const urgent = (await tree())
      .filter((node) => node.kind === "agent" && (node.status?.kind === "error" || node.status?.kind === "needs-you"))
      .sort((a, b) => (a.status!.kind === "error" ? 0 : 1) - (b.status!.kind === "error" ? 0 : 1) || a.status!.since - b.status!.since);

    expect(urgent.filter((node) => agents.some((each) => each.id === node.id)).length).toBe(5);

    const visited: (string | null)[] = [];

    for (let press = 0; press <= urgent.length; press += 1) {
      fireEvent.keyDown(document, { key: "j", metaKey: true });
      await waitFor(() => expect(selected()).not.toBe(visited.at(-1) ?? working));
      visited.push(selected());

      if (urgent[press % urgent.length]?.status?.kind === "needs-you") {
        await waitFor(() => expect(screen.getByRole("region", { name: /Decision for/ })).toBeTruthy());
      } else {
        expect(screen.queryByRole("region", { name: /Decision for/ })).toBeNull();
      }
    }

    expect(visited.slice(0, urgent.length)).toEqual(urgent.map((node) => node.id));
    expect(visited.at(-1)).toBe(urgent[0]!.id);
  }, 420_000);
});
