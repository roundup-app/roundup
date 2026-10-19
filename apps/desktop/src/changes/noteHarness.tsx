import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { ConnectedProject } from "../state/connectedProject";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { mountControl } from "./harness";

export const COMPARISON: FileComparison = { base: "base-commit", oldPath: "src/a.ts", newPath: "src/a.ts", status: "modified", old: { kind: "text", revision: "old-revision", text: "before\nsecond old\n" }, new: { kind: "text", revision: "new-revision", text: "after\nsecond new\n" } };

export const openFile = async (path = "src/a.ts") => {
  await waitFor(() => expectRow(path));
  fireEvent.click(document.querySelector("file-tree-container")!.shadowRoot!.querySelector(`[data-item-path="${path}"]`)!, { composed: true });
  fireEvent.click(screen.getByRole("button", { name: "View diff" }));
  await screen.findByRole("button", { name: "Add note" });
};

const expectRow = (path: string) => {
  if (!document.querySelector("file-tree-container")?.shadowRoot?.querySelector(`[data-item-path="${path}"]`)) throw new Error("file row not ready");
};

export const openDiff = async (project = "/p", drafts?: ConnectedProject["drafts"]) => {
  const mounted = await mountControl(undefined, project, drafts);
  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await openFile();

  return mounted;
};

export const saveNote = async (text: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit note 1" });
};
