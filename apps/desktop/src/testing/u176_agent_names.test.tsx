// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

import { Rail } from "../rail/Rail";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";

describe("u176 Agent names", () => {
  let real: StartedDaemon;

  beforeEach(async () => {
    // E10: the Agent's Claude is the pinned one, its model aimock serving this file's turns.
    real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u176_agent_names.json"));
  }, 120_000);

  afterEach(async () => {
    cleanup();
    await real?.stop();
  });

  it("u176_two_agents_added_to_one_workstream_are_told_apart_in_the_rail", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "Rail" });
    const agents = async () => (await app.rpc("rail.tree", null)).filter((node) => node.kind === "agent");

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);

    for (const count of [1, 2]) {
      const add = await within(rail).findByLabelText("Add Agent", {}, { timeout: 30_000 });

      await waitFor(() => expect(add.matches('[aria-disabled="true"]')).toBe(false), { timeout: 30_000 });
      fireEvent.click(add);
      await waitFor(async () => expect(await agents()).toHaveLength(count), { timeout: 30_000 });
      await waitFor(async () => expect((await agents())[count - 1]!.status?.label).not.toBe("starting"), { timeout: 30_000 });
      await waitFor(async () => expect(await app.rpc("agent.prompt", { id: (await agents())[count - 1]!.id, text: "what should this do" })).toBeNull(), { timeout: 30_000 });
      await waitFor(async () => expect((await agents())[count - 1]!.name).not.toBe("new-agent"), { timeout: 60_000 });

      // Only the second Agent keeps a pending Decision; the first one's is allowed.
      if (count === 1) {
        const first = (await agents())[0]!.id;

        await waitFor(async () => {
          for (const decision of await app.rpc("decision.list", null)) if (decision.agent === first) await app.rpc("decision.answer", { id: decision.id, answer: "allow", proof: await app.daemonProof() });
          expect((await app.rpc("decision.list", null)).filter((decision) => decision.agent === first)).toHaveLength(0);
        }, { timeout: 60_000 });
      }
    }

    const nodes = await agents();
    const names = nodes.map((node) => node.name);

    expect(new Set(names).size).toBe(2);
    await waitFor(() => {
      for (const name of names) expect(within(rail).getAllByText(name).length).toBeGreaterThan(0);
    });

    const second = nodes[1]!;

    await waitFor(async () => expect((await app.rpc("decision.list", null)).map((decision) => decision.agent)).toContain(second.id), { timeout: 60_000 });
    fireEvent.click(rail.querySelector(`[data-id="${second.id}"] .name`) ?? rail);
    expect(await screen.findByRole("region", { name: `Decision for ${second.name}` }, { timeout: 30_000 })).toBeTruthy();
    await real.model!.assertMatched();
  }, 180_000);

});

describe("u2773 retained Rail names", () => {
  afterEach(() => { cleanup(); localStorage.clear(); });

  it("u2773a_rail_real_projects_keep_name_destinations_on_reopen", async () => {
    const first = await startRealDaemon({});
    const second = await startRealDaemon({});

    try {
      const sources = [first, second];
      const records = [];

      for (const [index, real] of sources.entries()) {
        const app = createServedApp(real.base);

        if (index === 1) await app.rpc("rail.createWorkstream", { name: "other", parent: null });
        const target = await app.rpc("rail.createWorkstream", { name: "same", parent: null });
        const mounted = await connectProject(app, { name: "same", path: real.dir }, () => false, Date.now, () => null);

        render(() => <ConnectedProjectContext.Provider value={mounted}><Rail /></ConnectedProjectContext.Provider>);
        fireEvent.dblClick(await screen.findByText("same"));
        fireEvent.input(screen.getByLabelText("Name"), { target: { value: ` exact ${index}\u0301 😀 ` } });
        records.push({ real, app, target, text: ` exact ${index}\u0301 😀 ` });
        cleanup();
      }

      expect(records[0]!.target.id).not.toBe(records[1]!.target.id);

      for (const { real, app, target, text } of records) {
        const calls = vi.spyOn(app, "rpc");
        const mounted = await connectProject(app, { name: "same", path: real.dir }, () => false, Date.now, () => null);

        render(() => <ConnectedProjectContext.Provider value={mounted}><Rail /></ConnectedProjectContext.Provider>);
        fireEvent.dblClick(await screen.findByText("same"));
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(text);
        expect(calls.mock.calls.filter(([method]) => method === "rail.rename")).toEqual([]);
        fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
        await waitFor(async () => expect((await app.rpc("rail.tree", null)).find((node) => node.id === target.id)?.name).toBe(text.trim()));
        expect(calls.mock.calls.filter(([method]) => method === "rail.rename")).toEqual([["rail.rename", { id: target.id, name: text.trim() }]]);
        cleanup();
      }
    } finally {
      cleanup();
      await first.stop();
      await second.stop();
    }
  }, 120_000);

  it("u2773c_rail_real_external_name_change_refuses_overwrite", async () => {
    const real = await startRealDaemon({});

    try {
      const app = createServedApp(real.base);
      const target = await app.rpc("rail.createWorkstream", { name: "original", parent: null });
      const mounted = await connectProject(app, { name: "project", path: real.dir }, () => false, Date.now, () => null);

      render(() => <ConnectedProjectContext.Provider value={mounted}><Rail /></ConnectedProjectContext.Provider>);
      fireEvent.dblClick(await screen.findByText("original"));
      fireEvent.input(screen.getByLabelText("Name"), { target: { value: " exact dirty name 😀 " } });
      await app.rpc("rail.rename", { id: target.id, name: "external" });
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("original name changed"));
      const calls = vi.spyOn(app, "rpc");

      fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
      expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(" exact dirty name 😀 ");
      expect(calls.mock.calls.filter(([method]) => method === "rail.rename")).toEqual([]);
      expect((await app.rpc("rail.tree", null)).find((node) => node.id === target.id)?.name).toBe("external");
    } finally {
      cleanup();
      await real.stop();
    }
  }, 120_000);

});
