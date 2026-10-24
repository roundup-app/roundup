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

const settle = async (prompt: string) => {
  // E10: the Door's Claude is the pinned one, its model aimock serving this test's turns.
  real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), `src/testing/fixtures/u166_allow.json`));
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

  await waitFor(async () => expect((await workstreams()).find((room) => room.id === first?.id)?.status?.kind).toBe("needs-you"), { timeout: 30_000 });

  await waitFor(async () => expect((await workstreams()).find((workstream) => workstream.id === second?.id)?.status?.kind).toBe("idle"), { timeout: 60_000 });
  await waitFor(() => expect(rail.querySelector(`.rail-row[data-id="${first?.id}"]`)?.getAttribute("data-kind")).toBe("needs-you"), { timeout: 30_000 });
  await waitFor(() => expect(rail.querySelector(`.rail-row[data-id="${second?.id}"]`)?.getAttribute("data-kind")).toBe("idle"), { timeout: 30_000 });

  const otherBefore = (await workstreams()).find((room) => room.id === second?.id)?.status?.kind;

  expect(otherBefore).not.toBe("needs-you");
  // The Door's native prompt waits in its own Terminal: no roundup form appears, and selecting the row leaves the other Workstream as it was.
  expect(screen.queryByRole("region", { name: / wants to / })).toBeNull();
  fireEvent.click(rail.querySelector<HTMLElement>(`[data-id="${first?.id}"] .name`)!);
  await waitFor(() => expect(rail.querySelector("[data-selected=true]")?.getAttribute("data-id")).toBe(first?.id));
  expect(screen.queryByRole("region", { name: / wants to / })).toBeNull();
  expect((await workstreams()).find((room) => room.id === second?.id)?.status?.kind).toBe(otherBefore);
  expect(await messages()).toContainEqual([prompt, "delivered"]);

  cleanup();

  const Reopened = mount();

  await waitFor(async () => expect((await Reopened.rpc("rail.tree", null)).find((node) => node.id === first?.id)?.status?.kind).toBe("needs-you"), { timeout: 30_000 });
  expect(await messages()).toContainEqual([prompt, "delivered"]);

  await real.model!.assertMatched();
};

describe("u166 a Door's native prompt waits in its Terminal on the real Daemon", () => {
  it("u166_a_door_needing_you_leaves_the_other_workstream_and_its_message_delivered", async () => {
    await settle("ship a");
  }, 240_000);
});
