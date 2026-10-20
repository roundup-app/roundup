// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

afterEach(async () => {
  cleanup();
  await real?.stop();
});

const mount = () => {
  const app: AppSeam = createServedApp(real.base);

  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  return app;
};

const settle = async (answer: "allow" | "deny", prompt: string) => {
  // E10: the Door's Claude is the pinned one, its model aimock serving this test's turns.
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), `src/testing/fixtures/u166_${answer}.json`));
  const app = mount();
  const rail = await screen.findByRole("region", { name: "Rail" });
  const workstreams = async () => (await app.rpc("rail.tree", null)).filter((node) => node.kind === "workstream");
  const messages = async () => (await app.rpc("message.list", { to: null, status: null })).map((message) => [message.body, message.status]);

  const startDoor = async () => {
    const id = (await workstreams()).at(-1)!.id;

    fireEvent.click(await within(rail).findByRole("button", { name: /Start supervisor/i }));
    // SessionStart can read idle before the initial prompt begins. Wait for this
    // Door's fixture reply, then its Stop, before another Workstream can affect it.
    await waitFor(async () => {
      const door = (await workstreams()).find((node) => node.id === id)!;

      expect(door.terminal_id).not.toBeNull();
      expect((await app.rpc("terminal.screen", { id: door.terminal_id! })).lines.join("\n")).toContain("Ready for your instructions.");
      expect((await workstreams()).find((node) => node.id === id)?.status?.kind).toBe("idle");
    }, { timeout: 60_000 });
  };

  fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);
  await waitFor(async () => expect(await workstreams()).toHaveLength(1), { timeout: 30_000 });
  await startDoor();
  // The add is disabled while the Door is pending (U143).
  const add = await within(rail).findByRole("button", { name: /^\s*(New Workstream|Add Workstream)$/ });

  await waitFor(() => expect(add.matches('[aria-disabled="true"]')).toBe(false), { timeout: 60_000 });
  fireEvent.click(add);
  await waitFor(async () => expect(await workstreams()).toHaveLength(2), { timeout: 30_000 });
  await startDoor();

  // The Workstream just started is the selected one; the earlier one is "second", the other Workstream.
  const [second, first] = await workstreams();

  // U467: the user types to the Door in its Terminal; the Message is the same Daemon delivery without the keystrokes.
  await app.rpc("message.send", { to: first!.id, kind: "note", body: prompt, replyTo: null });

  await waitFor(async () => expect(await messages()).toContainEqual([prompt, "delivered"]), { timeout: 90_000 });

  const card = await waitFor(
    () => {
      const found = screen.getByRole("region", { name: /Decision for/ });

      expect(found.textContent).toContain(prompt);

      return found;
    },
    { timeout: 30_000 },
  );

  await waitFor(async () => expect((await workstreams()).find((room) => room.id === first?.id)?.status?.kind).toBe("needs-you"), { timeout: 30_000 });

  await waitFor(async () => expect((await workstreams()).find((workstream) => workstream.id === second?.id)?.status?.kind).toBe("idle"), { timeout: 60_000 });
  await waitFor(() => expect(rail.querySelector(`.rail-row[data-id="${first?.id}"]`)?.getAttribute("data-kind")).toBe("needs-you"), { timeout: 30_000 });
  await waitFor(() => expect(rail.querySelector(`.rail-row[data-id="${second?.id}"]`)?.getAttribute("data-kind")).toBe("idle"), { timeout: 30_000 });

  const otherBefore = (await workstreams()).find((room) => room.id === second?.id)?.status?.kind;
  const toSecond = async () => (await app.rpc("message.list", { to: null, status: null })).filter((message) => message.to === second?.id);
  const secondThread = await toSecond();
  const decisionsBefore = await app.rpc("decision.list", null);

  expect(otherBefore).not.toBe("needs-you");
  expect(decisionsBefore).toHaveLength(1);

  fireEvent.click(within(card).getByRole("button", { name: answer === "allow" ? "Allow" : "Deny" }));

  await waitFor(() => expect(screen.queryByRole("region", { name: /Decision for/ })).toBeNull(), { timeout: 30_000 });
  await waitFor(async () => expect((await workstreams()).find((room) => room.id === first?.id)?.status?.kind).toBe("idle"), { timeout: 30_000 });
  expect(await messages()).toContainEqual([prompt, "delivered"]);
  expect((await workstreams()).find((room) => room.id === second?.id)?.status?.kind).toBe(otherBefore);
  expect(await toSecond()).toEqual(secondThread);
  expect(await app.rpc("decision.list", null)).toHaveLength(0);

  // The rendered App, not only the Daemon, shows the Workstream idle with no reload.
  await waitFor(() => expect(rail.querySelector(`.rail-row[data-id="${first?.id}"]`)?.getAttribute("data-kind")).toBe("idle"), { timeout: 30_000 });

  if (answer === "allow") {
    expect(await screen.findByText(new RegExp(prompt), { selector: "[data-todo] *" }, { timeout: 30_000 })).toBeTruthy();
  }

  fireEvent.click(await waitFor(() => {
    const name = rail.querySelector<HTMLElement>(`[data-id="${second?.id}"] .name`);

    expect(name).not.toBeNull();

    return name!;
  }));
  expect(screen.queryByRole("region", { name: /Decision for/ })).toBeNull();

  cleanup();

  const Reopened = mount();

  await waitFor(async () => expect((await Reopened.rpc("rail.tree", null)).filter((node) => node.kind === "workstream").map((room) => room.status?.kind)).not.toContain("needs-you"), { timeout: 30_000 });
  expect(await messages()).toContainEqual([prompt, "delivered"]);

  await real.model!.assertMatched();

  return (await Reopened.rpc("todo.list", null)).map((todo) => todo.title);
};

describe("u166 a Door's answered permission ends with the Workstream idle on the real Daemon", () => {
  it("u166_allow_runs_the_tool_call_and_the_room_is_idle_with_its_message_delivered", async () => {
    expect(await settle("allow", "ship a")).toContain("ship a");
  }, 240_000);

  it("u166_deny_makes_no_tool_call_and_the_room_is_idle_with_its_message_delivered", async () => {
    expect(await settle("deny", "ship b")).not.toContain("ship b");
  }, 240_000);
});
