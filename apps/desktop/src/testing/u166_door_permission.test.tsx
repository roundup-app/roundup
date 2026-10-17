// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

let real: StartedDaemon;

let pump: ReturnType<typeof setInterval> | undefined;

beforeEach(async () => {
  real = await startRealDaemon({
    FAKE_CLAUDE_ON_PROMPT_ASK: JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo $prompt" } }),
    FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }),
  });
}, 120_000);

afterEach(async () => {
  clearInterval(pump);
  cleanup();
  await real?.stop();
});

const mount = () => {
  const app: AppSeam = createServedApp(real.base);

  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  return app;
};

const settle = async (answer: "allow" | "deny", prompt: string) => {
  const app = mount();
  const rail = await screen.findByRole("region", { name: "Rail" });
  const workstreams = async () => (await app.rpc("rail.tree", null)).filter((node) => node.kind === "workstream");
  const ready = async () => expect((await app.rpc("rail.tree", null)).map((node) => node.status?.label)).not.toContain("starting");
  const messages = async () => (await app.rpc("message.list", { to: null, status: null })).map((message) => [message.body, message.status]);

  // A Door started with no message first hears its Clarification order (O2), which the fake also asks about;
  // the pump allows each such Decision, never the one for the typed prompt.
  pump = setInterval(async () => {
    try {
      for (const decision of await app.rpc("decision.list", null)) if (!decision.args.includes(prompt)) await app.rpc("decision.answer", { id: decision.id, answer: "allow", proof: await app.daemonProof() });
    } catch {
      // The Daemon or the App is gone; the test has ended.
    }
  }, 300);

  const startDoor = async () => {
    fireEvent.click(await within(rail).findByRole("button", { name: /Start supervisor/i }));
    await waitFor(ready, { timeout: 30_000 });
  };

  fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);
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
  clearInterval(pump);

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
    await waitFor(async () => expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toContain(prompt), { timeout: 30_000 });
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
