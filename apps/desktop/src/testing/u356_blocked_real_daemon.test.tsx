import { leaderKey } from "../keys/leaderFixture";
// @vitest-environment jsdom
import { rowStatusLabel } from "./rowTip";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp, spawnPrompted } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

// Two Workstreams of five Agents each, one `blocked` in each; the Agent with id N plays entry N (U351, U356).
const FIRST = ["blocked", "working", "idle", "working", "idle"];

const SECOND = ["error", "needs-you", "blocked", "error", "needs-you"];

beforeAll(async () => {
  // E10: each Agent's turns are chosen by its id in the order it hears; its Claude is the pinned one, its model aimock serving this file's turns.
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u356_blocked.json"));
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u356 the fake claude holds an Agent blocked in every Workstream, observed on the real Daemon", () => {
  it("u356_two_blocked_agents_read_waits_on_their_own_blocker_collapse_to_blocked_and_the_jump_skips_them", async () => {
    const app: AppSeam = createServedApp(real.base);

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
    const waits: string[] = [];

    for (const kinds of [FIRST, SECOND]) {
      const known = (await tree()).filter((node) => node.kind === "workstream").map((node) => node.id);

      fireEvent.click((await screen.findAllByRole("button", { name: /^\s*(New Workstream|Add Workstream)$/ }))[0]!);
      await waitFor(async () => expect((await tree()).filter((node) => node.kind === "workstream")).toHaveLength(known.length + 1), { timeout: 30_000 });

      const workstream = (await tree()).find((node) => node.kind === "workstream" && !known.includes(node.id))!.id;

      workstreams.push(workstream);
      // The Door's button shows only while it has not started, so press it until the Door is not "starting" or gone.
      await waitFor(async () => {
        const start = within(rail).queryByRole("button", { name: /Start supervisor/i });

        if (start && !start.hasAttribute("disabled")) fireEvent.click(start);

        expect((await tree()).find((node) => node.id === workstream)?.status?.label).not.toBe("starting");
        await doorsReady();
      }, { timeout: 30_000, interval: 1000 });

      for (const [at, kind] of kinds.entries()) {
        await spawnPrompted(app, real.dir, workstream);
        await waitFor(async () => expect(await agentsOf(workstream)).toHaveLength(at + 1), { timeout: 30_000, interval: 1000 });

        const born = (await agentsOf(workstream)).find((node) => !agents.some((each) => each.id === node.id))!;

        await waitFor(async () => expect((await tree()).find((node) => node.id === born.id)?.status?.kind).toBe(kind), { timeout: 60_000 });
        // rail.tree can answer before the event-driven Rail refresh renders this Agent.
        await waitFor(() => expect(row(born.id).querySelector('.glyph[role="img"]')?.getAttribute("aria-label")).toBe(kind[0]!.toUpperCase() + kind.slice(1)), { timeout: 30_000 });
        agents.push({ id: born.id, kind });
      }
    }

    // Observed: every row's glyph and Status word agree with its entry, not by colour alone.
    for (const { id, kind } of agents) {
      fireEvent.click(row(id).querySelector(".name")!);
      await waitFor(() => expect(selected()).toBe(id));

      const glyph = row(id).querySelector('.glyph[role="img"]');
      const word = await rowStatusLabel(row(id));
      const node = (await tree()).find((each) => each.id === id);

      expect(glyph?.getAttribute("aria-label")).toBe(kind[0]!.toUpperCase() + kind.slice(1));
      expect(word).toBe(node?.status?.label);
      expect(word.length).toBeGreaterThan(0);

      if (kind === "blocked") {
        expect(word).toMatch(/^waits on #\d+$/);
        waits.push(word);
      }
    }

    // Each blocked Agent waits on its own blocker, which is an open Todo.
    expect(new Set(waits).size).toBe(2);

    const todos = await app.rpc("todo.list", null);

    for (const word of waits) {
      const blocker = todos.find((todo) => `waits on #${todo.id}` === word);

      expect(blocker?.title).toBe("u356 blocker");
      expect(blocker?.done).toBe(false);
    }

    const kindOf = async (id: string) => (await tree()).find((node) => node.id === id)?.status?.kind;

    // U403: a collapsed Workstream row leads its Agent Glyphs with the most urgent Kind of its Agents.
    for (const [workstream, kind] of [[workstreams[0]!, "blocked"], [workstreams[1]!, "error"]] as const) {
      fireEvent.click(row(workstream).querySelector('button[aria-label="Collapse"]')!);
      await waitFor(() => expect(row(workstream).querySelector('.folded-agents .glyph[role="img"]')?.getAttribute("aria-label")).toBe(kind[0]!.toUpperCase() + kind.slice(1)));
      fireEvent.click(row(workstream).querySelector('button[aria-label="Collapse"]')!);
      const agent = (await agentsOf(workstream))[0]!;

      await waitFor(() => expect(row(agent.id)).toBeTruthy());
    }

    // Quiet: a working Agent opens no Decision Card and the selection stays.
    const working = agents.find((each) => each.kind === "working")!.id;

    fireEvent.click(row(working).querySelector(".name")!);
    await waitFor(() => expect(selected()).toBe(working));
    // Observe beyond H12's ten-second STEER_BOUND (crates/agents/src/lib.rs):
    // an early synthetic acknowledgement must not become a late prompt failure.
    await new Promise((done) => setTimeout(done, 11_000));
    expect(selected()).toBe(working);
    expect(screen.queryByRole("region", { name: /Decision for/ })).toBeNull();
    expect(await kindOf(working)).toBe("working");

    // Jump: `error` before `needs-you`, oldest first, across both Workstreams, then it wraps.
    const urgent = (await tree())
      .filter((node) => node.kind === "agent" && (node.status?.kind === "error" || node.status?.kind === "needs-you"))
      .sort((a, b) => (a.status!.kind === "error" ? 0 : 1) - (b.status!.kind === "error" ? 0 : 1) || a.status!.since - b.status!.since);

    expect(urgent.filter((node) => agents.some((each) => each.id === node.id)).length).toBe(4);

    const visited: (string | null)[] = [];

    for (let press = 0; press <= urgent.length; press += 1) {
      leaderKey("KeyJ");
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

    const blocked = agents.flatMap((each) => (each.kind === "blocked" ? [each.id] : []));

    expect(visited.filter((id) => blocked.includes(id!))).toEqual([]);
    await real.model!.assertMatched(2);
  }, 420_000);
});
