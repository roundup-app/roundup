import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { COMPARISON, openDiff } from "./noteHarness";
import { RpcError } from "../app/seam";
import { mountControl } from "./harness";

afterEach(cleanup);

it("u2540a_open_back_close_and_editor_actions", async () => {
  const { app } = await mountControl();
  app.handlers["agent.compareFile"] = () => ({ base: "base-commit", oldPath: "src/a.ts", newPath: "src/a.ts", status: "modified", old: { kind: "text", revision: "old-revision", text: "before\n" }, new: { kind: "text", revision: "new-revision", text: "after\n" } });
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  const row = document.querySelector("file-tree-container")!.shadowRoot!.querySelector('[data-item-path="src/a.ts"]')!;
  fireEvent.click(row, { composed: true });
  fireEvent.click(screen.getByRole("button", { name: "View diff" }));
  await screen.findByRole("button", { name: "Add note" });
  expect(app.calls.filter(c => c.method === "agent.compareFile").map(c => c.params)).toEqual([{ id: "a", path: "src/a.ts" }]);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(document.querySelector("file-tree-container")?.shadowRoot?.activeElement?.getAttribute("data-item-path")).toBe("src/a.ts"));
  fireEvent.keyDown(document.querySelector("file-tree-container")!.shadowRoot!.activeElement!, { key: "Enter", composed: true });
  await waitFor(() => expect(app.editorCalls).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "roundup/a" }));
});

it("u2540a_late_content_cannot_cross_agents", async () => {
  const { app, connected } = await mountControl();
  let resolve!: (value: typeof COMPARISON) => void;
  app.handlers["agent.compareFile"] = () => new Promise(done => { resolve = done; });
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  fireEvent.click(document.querySelector("file-tree-container")!.shadowRoot!.querySelector('[data-item-path="src/a.ts"]')!, { composed: true });
  fireEvent.click(screen.getByRole("button", { name: "View diff" }));
  await waitFor(() => expect(app.calls.some(call => call.method === "agent.compareFile")).toBe(true));
  connected.rail.select("plain");
  resolve(COMPARISON);
  await Promise.resolve();
  expect(screen.queryByRole("region", { name: "Diff" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
});

it("u2540a_nontext_empty_and_failed_reads_remain_navigable", async () => {
  const { app } = await openDiff();
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, old: { kind: "binary", revision: "binary" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("button", { name: "Refresh" });
  expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
  expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, status: null });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(/No remaining difference/);
  app.handlers["agent.compareFile"] = () => { throw new RpcError(-32001, "Worktree unavailable"); };

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Worktree unavailable");
  app.handlers["agent.compareFile"] = () => COMPARISON;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Add note" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
