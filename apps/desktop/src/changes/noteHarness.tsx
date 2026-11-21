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

/** The tree's row for `path` in the newest Changes view: Pierre draws it inside a shadow root. */
export const treeRow = async (path: string): Promise<HTMLElement> => waitFor(() => {
  const row = [...document.querySelectorAll("file-tree-container")].at(-1)?.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);

  if (!row) throw new Error(`No tree row for ${path}`);

  return row;
});

/** The diff the user sees: another Project's view stays mounted, out of the accessibility tree. */
const shownDiff = () => screen.getByRole("region", { name: copy.diff }).querySelector<HTMLElement>(".diff-content");

export const waitDiff = () => waitFor(() => { if (!shownDiff()) throw new Error("No diff yet"); });

/** Reads one file's diff in the open Changes view: the first file opens by itself (U7674a), another is chosen in the tree. */
export const openFile = async (path = "src/a.ts") => {
  await waitDiff();
  const row = await treeRow(path);

  row.focus();
  await within(screen.getAllByLabelText("Diff").at(-1)!).findByText(path, { selector: ".diff-path" });
  // Restored drafts read after a tick (rc.21 reads lag writes): a note form opened at once would miss them.
  await new Promise(resolve => setTimeout(resolve, 50));
};

export const openDiff = async (project = "/p", drafts?: ConnectedProject["drafts"]) => {
  const mounted = await mountControl(undefined, project, drafts);
  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  await openChanges();
  await openFile();

  return mounted;
};

/** U7676b: N on the focused diff starts a note; keys follow focus, and a hidden Project's view can still hold it. */
export const startNote = () => {
  const diff = shownDiff()!;

  diff.focus();
  fireEvent.keyDown(diff, { key: "n" });
};

/** U7676d: the bar's count opens the batch list. */
export const openBatch = async () => {
  const count = await screen.findByRole("button", { name: /^\d+ notes?$/ });

  if (!noteList()) {
    fireEvent.click(count);
    await screen.findByRole("list", { name: copy.notes });
  }
};

/** U7677d: Esc leaves the open note: its footer says "Esc Cancel" and it has no Close button. */
export const leaveNote = () => fireEvent.keyDown(within(screen.getByRole("form", { name: copy.lineNote })).getByLabelText(copy.note), { key: "Escape" });

export const saveNote = async (text: string) => {
  // The pane's read lands after its element: N waits for it, as a user's key does.
  await waitFor(() => { if (!screen.queryByRole("form", { name: "Line note" })) startNote(); screen.getByRole("form", { name: "Line note" }); });
  const form = within(screen.getByRole("form", { name: "Line note" }));
  fireEvent.input(form.getByLabelText("Note"), { target: { value: text } });
  fireEvent.click(form.getByRole("button", { name: "Save" }));
  await openBatch();
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
};
