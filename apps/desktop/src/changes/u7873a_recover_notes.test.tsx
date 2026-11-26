import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { ConnectedProjectContext } from "../state/connectedProject";
import { storageIdle } from "../state/storage";
import { refuseUngroupedRead } from "../testing/fakeApp";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { COMPARISON } from "./noteHarness";
import { NoteRecovery } from "./NoteBatch";
import { notesFor } from "./notes";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await storageIdle(); localStorage.clear(); });

const NEWER = { ...COMPARISON, new: { kind: "text" as const, revision: "newer-revision", text: "newer\n" } };

/** Recover notes open on a kept note of Agent `plain`, which has no Worktree. */
const recover = async (path: string, read: (params: Parameters<typeof refuseUngroupedRead>[1]) => typeof NEWER) => {
  const { app, connected } = await mountControl();

  app.handlers["agent.compareFile"] = params => {
    refuseUngroupedRead(app, params);

    return read(params);
  };

  const notes = notesFor(app, "/p", connected.drafts);

  notes.editForm("plain", { revision: "kept", comparison: { ...COMPARISON, oldPath: path, newPath: path }, replacing: null, side: "new", start: "1", end: "1", text: "kept", selection: null });
  render(() => {
    const [open, setOpen] = createSignal(true);

    return <ConnectedProjectContext value={connected}><NoteRecovery notes={notes} open={open()} onOpenChange={setOpen} available={() => false} name={() => "plain"} /></ConnectedProjectContext>;
  });

  return { app, dialog: within(await screen.findByRole("dialog", { name: copy.recoverNotes })) };
};

it("u7873a_recover_notes_marks_an_older_note_without_a_worktree", async () => {
  const { app, dialog } = await recover("src/a.ts", () => NEWER);

  await waitFor(() => expect(dialog.getByText(copy.originalContext.trim(), { exact: false })).toBeTruthy());
  expect(app.calls.filter(call => call.method === "agent.compareFile").map(call => call.params)).toEqual([{ id: "plain", path: "src/a.ts", group: { repo: "/p/.roundup/a", branch: "roundup/a" } }]);
});

it("u7873a_a_note_the_panel_cannot_compare_says_so", async () => {
  const unlisted = await recover("not/listed.ts", () => NEWER);

  await waitFor(() => expect(unlisted.dialog.getByText(copy.cannotCompare.trim(), { exact: false })).toBeTruthy());
  expect(unlisted.app.calls.filter(call => call.method === "agent.compareFile")).toEqual([]);
  cleanup();
  const failing = await recover("src/a.ts", () => { throw new Error("read refused"); });

  await waitFor(() => expect(failing.dialog.getByText(copy.cannotCompare.trim(), { exact: false })).toBeTruthy());
});
