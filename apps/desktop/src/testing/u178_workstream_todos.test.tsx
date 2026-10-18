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
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u178_agent_todo.json"));
}, 120_000);

afterEach(async () => {
  cleanup();
  await real?.stop();
});

it("u178_this_one_lists_the_todo_an_agent_made_in_the_workstream", async () => {
  const app: AppSeam = createServedApp(real.base);

  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  const rail = await screen.findByRole("region", { name: "Rail" });
  const agents = async () => (await app.rpc("rail.tree", null)).filter((node) => node.kind === "agent");

  fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);

  const add = await within(rail).findByLabelText("Add Agent", {}, { timeout: 30_000 });

  await waitFor(() => expect(add.matches('[aria-disabled="true"]')).toBe(false), { timeout: 30_000 });
  fireEvent.click(add);
  await waitFor(async () => expect(await agents()).toHaveLength(1), { timeout: 30_000 });
  await waitFor(async () => expect((await agents())[0]!.status?.label).not.toBe("starting"), { timeout: 30_000 });

  const made = (await agents())[0]!;

  await waitFor(async () => expect(await app.rpc("agent.prompt", { id: made.id, text: "ship d" })).toBeNull(), { timeout: 30_000 });

  // The Agent asks before its tool call; `allow` lets it make the Todo.
  await waitFor(async () => {
    for (const decision of await app.rpc("decision.list", null)) if (decision.args.includes("ship d")) await app.rpc("decision.answer", { id: decision.id, answer: "allow", proof: await app.daemonProof() });
    expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toContain("ship d");
  }, { timeout: 90_000 });

  // Creation is visible before home_in_workstream finishes assigning the Home.
  const todo = await waitFor(async () => {
    const found = (await app.rpc("todo.list", null)).find((candidate) => candidate.title === "ship d")!;

    expect(found.home).toBe(made.parent);

    return found;
  });

  fireEvent.click(rail.querySelector(`[data-id="${made.parent}"] .name`) ?? rail);
  await screen.findByRole("button", { name: "Show all Workstreams" });

  const list = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".todo-list");

    expect(found).not.toBeNull();

    return found!;
  });

  expect(within(list).getByRole("button", { name: new RegExp(`#${todo.id} ship d`) })).toBeTruthy();
  await real.model!.assertMatched();
}, 240_000);
