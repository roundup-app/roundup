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

/** The list's file row for `path` in the newest Changes view: its module unfolds first, by Right, which chooses nothing. */
export const treeRow = async (path: string): Promise<HTMLElement> => waitFor(() => {
  const list = [...document.querySelectorAll<HTMLElement>(".changes-tree")].at(-1);

  for (const folded of list?.querySelectorAll<HTMLElement>('[data-row="module"][aria-expanded="false"]') ?? []) fireEvent.keyDown(folded, { key: "ArrowRight" });
  const row = [...list?.querySelectorAll<HTMLElement>('[data-row="file"]') ?? []].find(each => each.dataset.path === path);

  if (!row) throw new Error(`No list row for ${path}`);

  return row;
});

let shown = "";

/** The diff the user sees: another Project's view stays mounted, out of the accessibility tree; of a module's files, the one last opened. */
const shownDiff = () => {
  const regions = screen.getAllByRole("region", { name: copy.diff });
  const region = regions.find(each => each.closest<HTMLElement>(".module-file")?.dataset.path === shown) ?? regions[0];

  return region?.querySelector<HTMLElement>(".diff-content") ?? null;
};

export const waitDiff = () => waitFor(() => { if (!shownDiff()) throw new Error("No diff yet"); });

/** Reads one file's diff in the open Changes view: the first module opens by itself (U7678d), a file is chosen by its row in its module. */
export const openFile = async (path = "src/a.ts") => {
  await waitDiff();
  const row = await treeRow(path);

  shown = path;
  row.focus();
  await waitFor(() => { if (!screen.getAllByText(path, { selector: ".diff-path" }).some(each => each.closest(".diff-reader")?.querySelector(".diff-content"))) throw new Error(`${path} is not drawn`); });
  // Restored drafts read after a tick (rc.21 reads lag writes): a note form opened at once would miss them.
  await new Promise(resolve => setTimeout(resolve, 50));
};

export const openDiff = async (project = "/p", drafts?: ConnectedProject["drafts"], changed?: Parameters<typeof mountControl>[0]) => {
  const mounted = await mountControl(changed, project, drafts);
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

/** The pane's read lands after its element (U7678d reads a module's first file at mount): N waits for it, as a user's key does. */
export const beginNote = () => waitFor(() => { if (!screen.queryByRole("form", { name: "Line note" })) startNote(); screen.getByRole("form", { name: "Line note" }); });

/** A saved note's form closes after its write: the next N waits for that, as a user's next key does. */
export const nextNote = async () => {
  await waitFor(() => { if (screen.queryByRole("form", { name: "Line note" })) throw new Error("The saved note's form is still open"); });
  await beginNote();
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
