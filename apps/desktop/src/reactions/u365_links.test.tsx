import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Reaction } from "@contracts/reaction/Reaction";
import { RpcError } from "../app/seam";
import { mountAskBar } from "../ask/askFixture";
import { agent } from "../testing/nodes";
import { copy } from "./copy";

afterEach(cleanup);

const mount = async (worktree: boolean) => {
  const { app, connected } = await mountAskBar([], null, [agent("receiver", "idle", "ready", {
    worktree: worktree ? { path: "/receiver", branch: "b", base: "main" } : null,
  })], false, "/project");

  const reaction: Reaction = {
    project: "p", reason: null, id: "r", name: "Review", actor: { kind: "user", id: "u", parent: null }, home: null, target: "receiver",
    instruction: "go", condition: { kind: "agents", ids: ["receiver"], any: false }, max_firings: 1, remaining: 0, rearm: false,
    expires_at: "2026-11-02T09:00:00Z", created_at: "2026-11-01T09:00:00Z", state: "stopped",
    observation: { health: "observing", health_code: "observing", cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: null, gap: null, recovery: null, evidence: null },
    firings: [{ id: "f", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "delivered" }],
  };

  app.handlers["reaction.list"] = () => [reaction];
  app.handlers["reaction.get"] = () => reaction;
  app.handlers["message.get"] = () => ({ id: 42, from: reaction.actor, to: "receiver", body: "src/a.ts:42 https://example.com", kind: "note", replyTo: null, status: "delivered", reason: null, at: 0 });
  connected.showView("reactions");
  window.dispatchEvent(new Event("focus"));
  fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Firing 1/ }));
  await screen.findByRole("link", { name: "src/a.ts:42" });

  return { app, connected };
};

it.each([true, false])("u365_message_relative_paths_use_the_receiver_%s", async worktree => {
  const { app, connected } = await mount(worktree);
  const selected = connected.rail.selected();
  fireEvent.click(screen.getByRole("link", { name: "src/a.ts:42" }));
  await waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: worktree ? "/receiver/src/a.ts" : "/project/src/a.ts", line: 42 }]));
  fireEvent.click(screen.getByRole("link", { name: "https://example.com" }));
  await waitFor(() => expect(app.openedTargets).toHaveLength(2));
  expect(connected.rail.selected()).toBe(selected);
  expect(app.calls.filter(call => ["reaction.stop", "reaction.run", "message.send", "agent.spawn", "terminal.write"].includes(call.method))).toEqual([]);
  fireEvent.click(within(screen.getByRole("region", { name: copy.reactionMessage(42) })).getByRole("button", { name: /^Close/ }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Firing 1/ })));
});

it("u365_message_missing_path_shows_failure", async () => {
  const { app } = await mount(true);
  app.openFailure = new RpcError(-32001, "not found");
  fireEvent.click(screen.getByRole("link", { name: "src/a.ts:42" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(app.openedTargets).toEqual([]);
});
