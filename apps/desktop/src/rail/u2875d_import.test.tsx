import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportDiscovery } from "@contracts/project/ImportDiscovery";
import type { ImportResult } from "@contracts/project/ImportResult";
import { RpcError } from "../app/seam";
import { workstream } from "../testing/nodes";
import { mountRail } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const found = (revision = "r1"): ImportDiscovery => ({
  candidates: [
    { source: "s1", title: "First", cwd: "", last_activity_ms: 2n, revision },
    { source: "s2", title: "Second", cwd: "src", last_activity_ms: 1n, revision: "r2" },
  ],
  excluded: [{ source: "s3", reason: "already in this Project" }],
});

const calls = (app: Awaited<ReturnType<typeof mountRail>>["app"], method: string) => app.calls.filter((call) => call.method === method);

describe("u2875d the import panel is an ordinary Rail action", () => {
  it("u2875d_keyboard_pointer_and_recovery", async () => {
    const { app } = await mountRail([workstream("w1")]);
    let discovered = found();
    let commit: () => ImportResult = () => ({ outcomes: [{ source: "s1", workstream: "w1", agent: "a1", error: null }, { source: "s2", workstream: null, agent: null, error: "disk full" }] });
    app.handlers["project.importDiscover"] = () => discovered;
    app.handlers["project.importCommit"] = () => commit();

    // Cancel changes nothing: only discovery was called.
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await screen.findByText("First");
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByRole("region", { name: "Import Claude Code work" }), { key: "Escape" });
    expect(screen.queryByText("First")).toBeNull();
    expect(app.calls.filter((call) => call.method !== "project.importDiscover" && call.method.startsWith("project.")).length).toBe(0);

    // A rejected call keeps the selection and the panel.
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await screen.findByText("First");
    fireEvent.click(screen.getByText("First"));
    fireEvent.click(screen.getByText("Second"));
    commit = () => { throw new RpcError(-32000, "daemon refused"); };

    fireEvent.click(await screen.findByRole("button", { name: "Import 2" }));
    await screen.findByText("daemon refused");
    expect(screen.getByRole("button", { name: "Import 2" })).toBeTruthy();

    // Partial failure: the success leaves the selection, the failure stays for retry, and each call names its sources.
    commit = () => ({ outcomes: [{ source: "s1", workstream: "w1", agent: "a1", error: null }, { source: "s2", workstream: null, agent: null, error: "disk full" }] });
    fireEvent.click(await screen.findByRole("button", { name: "Import 2" }));
    await screen.findByText("disk full");
    expect(calls(app, "project.importCommit").map((call) => call.params)).toEqual([
      { selections: [{ source: "s1", revision: "r1" }, { source: "s2", revision: "r2" }] },
      { selections: [{ source: "s1", revision: "r1" }, { source: "s2", revision: "r2" }] },
    ]);

    // Retry targets the failed source only, and a pending confirm cannot submit twice.
    let release: (result: ImportResult) => void = () => undefined;
    app.handlers["project.importCommit"] = () => new Promise<ImportResult>((resolve) => { release = resolve; });
    const retry = screen.getByRole("button", { name: "Retry failed" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(calls(app, "project.importCommit").length).toBe(3));
    expect(calls(app, "project.importCommit")[2]!.params).toEqual({ selections: [{ source: "s2", revision: "r2" }] });
    release({ outcomes: [{ source: "s2", workstream: "w1", agent: "a2", error: null }] });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Import Claude Code work" })).toBeNull());
    expect(calls(app, "project.importCommit").length).toBe(3);
  });

  it("u2875d_restored_selection_never_submits_and_a_changed_source_needs_refresh", async () => {
    localStorage.setItem("roundup:import:/p", JSON.stringify({ open: true, period: "month", selected: [{ source: "s1", revision: "r1", title: "First" }] }));
    const { app } = await mountRail([workstream("w1")]);
    app.handlers["project.importDiscover"] = () => found("changed");
    app.handlers["project.importCommit"] = () => ({ outcomes: [] });

    await screen.findByText(/chosen earlier/);
    expect(app.calls.filter((call) => call.method.startsWith("project.import"))).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Import 1" }));
    expect(calls(app, "project.importCommit")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Changed or gone since you chose them: First/);
    expect(calls(app, "project.importDiscover").map((call) => call.params)).toEqual([{ period: "month" }]);
    expect(screen.getAllByRole("checkbox").every((box) => box instanceof HTMLInputElement && !box.checked)).toBe(true);
  });
});
