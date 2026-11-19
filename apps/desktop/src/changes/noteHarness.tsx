import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import type { ConnectedProject } from "../state/connectedProject";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { captureActions } from "../keys/registry";
import { copy } from "./copy";
import { mountControl } from "./harness";

export const COMPARISON: FileComparison = { base: "base-commit", oldPath: "src/a.ts", newPath: "src/a.ts", status: "modified", old: { kind: "text", revision: "old-revision", text: "before\nsecond old\n" }, new: { kind: "text", revision: "new-revision", text: "after\nsecond new\n" } };

/** The notes batch of the open panel: the Toast region's own list is not it. */
export const noteList = () => screen.queryByRole("list", { name: copy.notes });

/** The leader chord `C`: opens the Changes view for the selected Agent. */
export const openChanges = async () => {
  const action = await waitFor(() => {
    const found = captureActions(document.body).find(each => each.value === "action:leader:C");

    if (!found) throw new Error("leader.changes is not available");

    return found;
  });

  action.run();
};

/** Opens the Changes view for the selected Agent and reads one file's diff in it (U7186c). */
export const openFile = async (path = "src/a.ts") => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));
  await screen.findByRole("button", { name: "Add note" });
};

export const openDiff = async (project = "/p", drafts?: ConnectedProject["drafts"]) => {
  const mounted = await mountControl(undefined, project, drafts);
  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  await openChanges();
  await openFile();

  return mounted;
};

export const saveNote = async (text: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const form = within(screen.getByLabelText("Line note", { selector: "form" }));
  fireEvent.input(form.getByLabelText("Note"), { target: { value: text } });
  fireEvent.click(form.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit note 1" });
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
};
