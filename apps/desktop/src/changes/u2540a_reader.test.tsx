import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
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
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "roundup/a" }));
});
