import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountPane, subscribed } from "../terminal/paneHarness";
import { agent, info } from "../testing/nodes";
import { ConnectedProjectContext } from "../state/connectedProject";
import { WorktreeControl } from "./WorktreeControl";
import { STATE, WORKTREE } from "./harness";
import { COMPARISON, openFile } from "./noteHarness";

afterEach(cleanup);

const mount = async () => {
  const mounted = await mountPane([agent("a", "idle", "ready", { worktree: WORKTREE })], [info("t-a")]);
  const { app, connected } = mounted;
  app.handlers["agent.worktreeState"] = () => STATE;
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", line: 1, status: "modified" }] });
  app.handlers["agent.compareFile"] = () => COMPARISON;
  connected.rail.select("a");
  render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
  await subscribed(app, "t-a");

  return mounted;
};

it("u2540d_close_returns_to_the_same_live_terminal", async () => {
  const { app, emulators } = await mount();
  const terminal = emulators.get("t-a")!;
  app.emitOutput("t-a", "kept output");
  terminal.type(new TextEncoder().encode("unsent draft"));
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(emulators.get("t-a")).toBe(terminal);
  expect(terminal.disposed).toBe(false);
  expect(terminal.written.map(bytes => new TextDecoder().decode(bytes)).join("")).toContain("kept output");
  terminal.type(new TextEncoder().encode("after close"));
  await waitFor(() => expect(app.calls.filter(call => call.method === "terminal.write")).toHaveLength(2));
});
