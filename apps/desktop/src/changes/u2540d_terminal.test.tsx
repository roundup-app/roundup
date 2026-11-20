import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountPane, subscribed } from "../terminal/paneHarness";
import { agent, info } from "../testing/nodes";
import { ToastHost } from "../testing/toastHost";
import { ConnectedProjectContext } from "../state/connectedProject";
import { ChangesView } from "./ChangesView";
import { WorktreeControl } from "./WorktreeControl";
import { STATE, WORKTREE } from "./harness";
import { COMPARISON, openFile, openChanges } from "./noteHarness";

afterEach(cleanup);

const mount = async () => {
  const mounted = await mountPane([agent("a", "idle", "ready", { worktree: WORKTREE })], [info("t-a")]);
  const { app, connected } = mounted;
  app.handlers["agent.worktreeState"] = () => STATE;
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", line: 1, status: "modified", counts: null }] });
  app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: WORKTREE.path, branch: WORKTREE.branch, base: WORKTREE.base, files: [{ path: "src/a.ts", line: 1, status: "modified", counts: null }] }] });
  app.handlers["agent.compareFile"] = () => COMPARISON;
  connected.rail.select("a");
  void connected.owned.refresh("a");
  render(() => <ToastHost><ConnectedProjectContext value={connected}><WorktreeControl /><ChangesView /></ConnectedProjectContext></ToastHost>);
  await subscribed(app, "t-a");

  return mounted;
};

it("u2540d_close_returns_to_the_same_live_terminal", async () => {
  const { app, emulators } = await mount();
  const terminal = emulators.get("t-a")!;
  app.emitOutput("t-a", "kept output");
  terminal.type(new TextEncoder().encode("unsent draft"));
  await openChanges();
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Changes" })).toBeNull());
  expect(emulators.get("t-a")).toBe(terminal);
  expect(terminal.disposed).toBe(false);
  expect(terminal.written.map(bytes => new TextDecoder().decode(bytes)).join("")).toContain("kept output");
  terminal.focus();
  terminal.type(new TextEncoder().encode("after close"));
  await waitFor(() => expect(app.calls.filter(call => call.method === "terminal.write")).toHaveLength(2));
});
