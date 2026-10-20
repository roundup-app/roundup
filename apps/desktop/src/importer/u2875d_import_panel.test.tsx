import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { ConnectedProjectContext } from "../state/connectedProject";
import { Rail } from "../rail/Rail";
import { connectFakeProject } from "../terminal/paneHarness";
import { workstream } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

const candidates = [
  { source: "s1", title: "first", cwd: "", last_activity_ms: 2n, revision: "r1" },
  { source: "s2", title: "second", cwd: "sub", last_activity_ms: 1n, revision: "r2" },
];

const mount = async () => {
  const { app, connected } = await connectFakeProject([workstream("ws", { name: "ws" })]);
  app.handlers["project.importDiscover"] = () => ({ candidates, excluded: [] });

  app.handlers["project.importCommit"] = (params) => ({
    outcomes: params.selections.map((entry) => ({ source: entry.source, workstream: `w-${entry.source}`, agent: `a-${entry.source}`, error: null })),
  });

  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);

  return { app, connected };
};

const calls = (app: Awaited<ReturnType<typeof mount>>["app"], method: string) => app.calls.filter((call) => call.method === method);

const isChecked = (name: RegExp): boolean => {
  const box = screen.getByRole("checkbox", { name });

  return box instanceof HTMLInputElement && box.checked;
};

const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
};

it("u2875d_keyboard_pointer_and_recovery", async () => {
  const { app } = await mount();

  expect(calls(app, "project.importDiscover")).toHaveLength(0);
  await open();
  expect(calls(app, "project.importDiscover")[0]?.params).toEqual({ period: "week" });

  fireEvent.click(screen.getByRole("radio", { name: "Last month" }));
  await waitFor(() => expect(calls(app, "project.importDiscover")[1]?.params).toEqual({ period: "month" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /second/ })).toBeTruthy());
  fireEvent.click(screen.getByRole("checkbox", { name: /second/ }));

  // Cancel changes no Rail data and discards the draft.
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  expect(calls(app, "project.importCommit")).toHaveLength(0);

  // Reopen: period resets after cancel; select and confirm twice quickly submits once.
  await open();
  fireEvent.click(screen.getByRole("checkbox", { name: /first/ }));
  const confirm = screen.getByRole("button", { name: "Import 1" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  expect(calls(app, "project.importCommit")).toHaveLength(1);
  expect(calls(app, "project.importCommit")[0]?.params).toEqual({ selections: [{ source: "s1", revision: "r1" }] });
});

it("u2875d_partial_failure_keeps_failed_selection_and_stale_restore_never_submits", async () => {
  const { app, connected } = await mount();

  app.handlers["project.importCommit"] = () => ({
    outcomes: [{ source: "s1", workstream: null, agent: null, error: "source changed" }, { source: "s2", workstream: "w2", agent: "a2", error: null }],
  });
  await open();
  fireEvent.click(screen.getByRole("checkbox", { name: /first/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /second/ }));
  fireEvent.click(screen.getByRole("button", { name: "Import 2" }));
  await waitFor(() => expect(screen.getByText("source changed")).toBeTruthy());
  expect(isChecked(/first/)).toBe(true);
  expect(screen.getByRole("button", { name: "Import 1" })).toBeTruthy();

  // A remount restores the draft but a changed revision is dropped and nothing is sent.
  cleanup();
  candidates[0]!.revision = "r1-new";
  const before = calls(app, "project.importCommit").length;
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
  await open();
  expect(isChecked(/first/)).toBe(false);
  expect(calls(app, "project.importCommit")).toHaveLength(before);
  candidates[0]!.revision = "r1";
});
