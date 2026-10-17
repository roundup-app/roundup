// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

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
