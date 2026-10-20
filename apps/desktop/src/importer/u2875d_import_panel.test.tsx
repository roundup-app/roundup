import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { ConnectedProjectContext } from "../state/connectedProject";
import { Rail } from "../rail/Rail";
import { RpcError } from "../app/seam";
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

it("u2875d_dialog_focus_and_escape_return_to_the_rail", async () => {
  await mount();
  const opener = screen.getByRole("button", { name: "Import Claude Code work" });

  await open();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")));
  fireEvent.keyDown(document.activeElement ?? document.body, { code: "Escape", key: "Escape", keyCode: 27 });
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("u2875d_period_change_clears_selection", async () => {
  const { app } = await mount();

  await open();
  fireEvent.click(screen.getByText("first"));
  await screen.findByRole("button", { name: "Import 1" });
  expect(isChecked(/first/)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Last month" }));
  await waitFor(() => expect(calls(app, "project.importDiscover")).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
  await waitFor(() => expect(isChecked(/first/)).toBe(false));
  expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
});

it.each([new RpcError(-32003, "daemon said no"), new Error("daemon said no")])("u2875d_rejected_call_keeps_period_and_selection (%s)", async (failure) => {
  const { app, connected } = await mount();

  app.handlers["project.importCommit"] = () => { throw failure; };

  await open();
  fireEvent.click(screen.getByRole("button", { name: "Last month" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("daemon said no")).toBeTruthy());
  expect(connected.drafts.list().find((draft) => draft.destination.surface === "import")?.status).toBe(failure instanceof RpcError ? "failed" : "unknown");
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
  await open();
  expect(calls(app, "project.importCommit")).toHaveLength(1);
  expect(isChecked(/first/)).toBe(true);
  expect(screen.getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
});

it("u2875a_discovery_exclusions_remain_visible_after_partial_failure", async () => {
  const { app } = await mount();
  app.handlers["project.importCommit"] = () => {
    app.handlers["project.importDiscover"] = () => ({ candidates: [candidates[1]!], excluded: [{ source: "s1", reason: "source unavailable" }] });

    return { outcomes: [{ source: "s1", workstream: null, agent: null, error: "copy refused" }] };
  };

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("source unavailable")).toBeTruthy());
  expect(screen.getByText("copy refused")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
});

it.each([false, true])("u2875d_cancel_consumes_only_the_current_draft (empty: %s)", async (empty) => {
  const { app, connected } = await mount();

  app.handlers["project.importCommit"] = () => { throw new RpcError(-32003, "daemon said no"); };

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("daemon said no")).toBeTruthy());
  fireEvent.click(screen.getByText("second"));
  await screen.findByRole("button", { name: "Import 2" });

  if (empty) {
    fireEvent.click(screen.getByText("first"));
    await screen.findByRole("button", { name: "Import 1" });
    fireEvent.click(screen.getByText("second"));
    await screen.findByRole("button", { name: "Import" });
  }

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
  await open();
  expect(isChecked(/first/)).toBe(true);
  expect(isChecked(/second/)).toBe(false);
  expect(calls(app, "project.importCommit")).toHaveLength(1);
});
