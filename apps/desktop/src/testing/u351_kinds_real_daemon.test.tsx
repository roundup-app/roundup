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

// Two Workstreams of five Agents each; the Nth Agent started plays entry N (U351).
const FIRST = ["working", "idle", "needs-you", "working", "idle"];

const SECOND = ["error", "needs-you", "working", "error", "needs-you"];

beforeAll(async () => {
  // A Door has `--tools`, plays no entry and is ready after its SessionStart, which FAKE_CLAUDE_ON_PROMPT plays.
  real = await startRealDaemon({
    FAKE_CLAUDE_KINDS: JSON.stringify([...FIRST, ...SECOND]),
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }),
  });
}, 120_000);

afterAll(async () => {
  await real?.stop();
});

afterEach(cleanup);

describe("u351 the fake claude holds each Agent in a Kind, observed on the real Daemon", () => {
  it("u351_ten_agents_read_their_kinds_the_jump_visits_error_then_needs_you_and_working_is_quiet", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "rail" });
    const tree = async () => app.rpc("rail.tree", null);
    const agentsOf = async (workstream: string) => (await tree()).filter((node) => node.kind === "agent" && node.parent === workstream);
    const doorsReady = async () => expect((await tree()).map((node) => node.status?.label)).not.toContain("starting");
    const selected = () => rail.querySelector('[role="treeitem"][data-selected="true"]')?.getAttribute("data-id") ?? null;

    const row = (id: string): HTMLElement => {
      const found = rail.querySelector<HTMLElement>(`[role="treeitem"][data-id="${id}"]`);

      if (!found) throw new Error(`no row ${id}`);

      return found;
    };

    const workstreams: string[] = [];
    const agents: { id: string; kind: string }[] = [];

    for (const kinds of [FIRST, SECOND]) {
      const known = (await tree()).filter((node) => node.kind === "workstream").map((node) => node.id);

      fireEvent.click((await screen.findAllByRole("button", { name: /^\s*new Workstream$/ }))[0]!);
      await waitFor(async () => expect((await tree()).filter((node) => node.kind === "workstream")).toHaveLength(known.length + 1), { timeout: 30_000 });

      const workstream = (await tree()).find((node) => node.kind === "workstream" && !known.includes(node.id))!.id;

      workstreams.push(workstream);
      // The Door's button shows only while it has not started, so press it until the Door is not "starting" or gone.
      await waitFor(async () => {
        const start = within(rail).queryByRole("button", { name: /start Door/ });

        if (start && !start.hasAttribute("disabled")) fireEvent.click(start);

        expect((await tree()).find((node) => node.id === workstream)?.status?.label).not.toBe("starting");
        await doorsReady();
      }, { timeout: 30_000, interval: 1000 });

      for (const [at, kind] of kinds.entries()) {
        // A press while the last start is still pending calls nothing (U9), so press again until the Agent is in the tree.
        await waitFor(async () => {
          if ((await agentsOf(workstream)).length <= at) fireEvent.click(await within(rail).findByRole("treeitem", { name: "add agent" }));

          expect(await agentsOf(workstream)).toHaveLength(at + 1);
        }, { timeout: 30_000, interval: 1000 });

        const born = (await agentsOf(workstream)).find((node) => !agents.some((each) => each.id === node.id))!;

        await waitFor(async () => expect((await tree()).find((node) => node.id === born.id)?.status?.kind).toBe(kind), { timeout: 60_000 });
        agents.push({ id: born.id, kind });
      }
    }

    // Observed: every row's glyph and Status word agree with its entry, not by colour alone.
    for (const { id, kind } of agents) {
      fireEvent.click(row(id).querySelector(".name")!);
      await waitFor(() => expect(selected()).toBe(id));

      // The row repaints after the Daemon's tree moves, so the glyph and word settle to the entry together.
      await waitFor(async () => {
        const glyph = row(id).querySelector('.glyph[role="img"]');
        const word = row(id).querySelector(".live-label")?.textContent ?? "";
        const node = (await tree()).find((each) => each.id === id);

        expect(glyph?.getAttribute("aria-label")).toBe(kind);
        expect(word).toBe(node?.status?.label);
        expect(word.length).toBeGreaterThan(0);
      }, { timeout: 30_000, interval: 500 });
    }

    const kindOf = async (id: string) => (await tree()).find((node) => node.id === id)?.status?.kind;

    // A Workstream row reads the most urgent Kind of its Agents once it is collapsed over them.
    for (const [workstream, kind] of [[workstreams[0]!, "needs-you"], [workstreams[1]!, "error"]] as const) {
      fireEvent.click(row(workstream).querySelector('button[aria-label="collapse"]')!);
      await waitFor(() => expect(row(workstream).getAttribute("data-kind")).toBe(kind));
      expect(row(workstream).querySelector('.glyph[role="img"]')?.getAttribute("aria-label")).toBe(kind);
      fireEvent.click(row(workstream).querySelector('button[aria-label="collapse"]')!);
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
