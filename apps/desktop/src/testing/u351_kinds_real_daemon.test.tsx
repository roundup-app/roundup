import { leaderKey } from "../keys/leaderFixture";
// @vitest-environment jsdom
import { rowStatusLabel } from "./rowTip";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Status } from "@contracts/Status";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp, spawnPrompted } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

const doorReady = async (statusOf: () => Promise<Status | null | undefined>, row: () => HTMLElement) => {
  // SessionStart/Stop publish Idle (claude_code/mod.rs); Working can still be the startup prompt.
  await waitFor(async () => {
    const status = await statusOf();

    expect(status?.kind).toBe("idle");
    expect(status?.label).toBe("idle");
    expect(row().getAttribute("data-kind")).toBe(status?.kind);
  });
};

const kindReady = async (statusOf: () => Promise<Status | null | undefined>, expected: string) => {
  await waitFor(async () => {
    const status = await statusOf();

    expect(status?.label).not.toBe("starting");
    expect(status?.kind).toBe(expected);
  }, { timeout: 60_000 });
};

let real: StartedDaemon;

// Two Workstreams of five Agents each; each Agent plays its named entry (U351).
const FIRST = ["working", "idle", "needs-you", "working", "idle"];

const SECOND = ["error", "needs-you", "working", "error", "needs-you"];

describe("u351 the fake claude holds each Agent in a Kind, observed on the real Daemon", () => {
  beforeAll(async () => {
    // E10: each Agent's turns are chosen by its seed name in the order it hears; its Claude is the pinned one, its model aimock serving this file's turns.
    real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u351_kinds.json"));
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
        await spawnPrompted(app, real.dir, workstream, `seed-${agents.length}`);
        await waitFor(async () => expect(await agentsOf(workstream)).toHaveLength(at + 1), { timeout: 30_000, interval: 1000 });

        const born = (await agentsOf(workstream)).find((node) => !agents.some((each) => each.id === node.id))!;

        // The Adapter starts at Working/starting; wait for the Kind its Claude reaches before launching the next one.
        await kindReady(async () => (await tree()).find((node) => node.id === born.id)?.status, kind);
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
    await real.model!.assertMatched(2);
  }, 420_000);
});
