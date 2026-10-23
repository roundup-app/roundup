import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { afterEach, expect, it } from "vitest";
import { Dialog } from "./Dialog";
import { mountSwitcher, openSwitcher, field, press } from "../switcher/switcherFixture";
import { openDiff, openFile, COMPARISON } from "../changes/noteHarness";
import { ConnectedProjectContext } from "../state/connectedProject";
import { NoteRecovery } from "../changes/NoteBatch";
import { notesFor } from "../changes/notes";
import { mountControl } from "../changes/harness";
import { agent } from "../testing/nodes";
import { mountSend, pressShortcut } from "../terminal/sendHarness";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";

afterEach(() => { cleanup(); localStorage.clear(); });

const modal = () => {
  const [open, setOpen] = createSignal(false);

  render(() => <Dialog.Root open={open()} onOpenChange={({ open }) => setOpen(open)}><Portal><Dialog.Positioner><Dialog.Content>
    <Dialog.Title>Import</Dialog.Title><button>Inside</button>
  </Dialog.Content></Dialog.Positioner></Portal></Dialog.Root>);

  return async (open: boolean) => {
    setOpen(open);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import" }) !== null).toBe(open));
  };
};

it.each(["ask", "switcher"] as const)("u3295b_modal_dismissal_keeps_unsubmitted_work: %s", async kind => {
  const { app, connected } = await mountSwitcher("dee");
  const show = async () => {
    if (kind === "switcher") openSwitcher();
    else press("/", { metaKey: true, code: "Slash" });
    return kind === "switcher" ? await screen.findByRole<HTMLInputElement>("combobox") : await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
  };
  const input = await show();
  const text = "  ops exact e\u0301 🐝  ";

  fireEvent.input(input, { target: { value: text } });
  const before = connected.drafts.list().filter(draft => draft.destination.surface === kind);
  const calls = app.calls.length;
  const change = modal();

  await change(true);
  await waitFor(() => expect(kind === "switcher" ? field() : document.querySelector('.ask-bar[data-mode="over"]')).toBeNull());
  await change(false);
  expect(kind === "switcher" ? field() : document.querySelector('.ask-bar[data-mode="over"]')).toBeNull();
  expect((await show()).value).toBe(text);
  expect(connected.drafts.list().filter(draft => draft.destination.surface === kind).map(draft => draft.destination)).toEqual(before.map(draft => draft.destination));
  expect(connected.rail.selected()).toBe("dee");
  expect(app.calls.slice(calls).filter(call => ["ask.send", "message.send", "takeover.begin"].includes(call.method))).toEqual([]);
});

it("u3295b_switcher_cannot_cover_a_dialog", async () => {
  await mountSwitcher("dee");
  const change = modal();

  await change(true);
  await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
  const focus = document.activeElement;

  openSwitcher();
  expect(field()).toBeNull();
  expect(document.activeElement).toBe(focus);
});

it.each(["worktree", "recovered notes"] as const)("u3295b_modal_dismissal_keeps_unsubmitted_work: %s", async kind => {
  const text = "  change e\u0301\n🐝 exact  ";
  const mounted = kind === "worktree" ? await openDiff() : await mountControl();
  const { app, connected } = mounted;
  const notes = notesFor(app, "/p", connected.drafts);

  if (kind === "worktree") {
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  } else {
    notes.editForm("a", { revision: "retained", comparison: COMPARISON, replacing: null, side: "new", start: "1", end: "1", text, selection: null });
    render(() => {
      const [open, setOpen] = createSignal(true);

      return <ConnectedProjectContext.Provider value={connected}><button onClick={() => setOpen(true)}>Recover</button><NoteRecovery notes={notes} open={open()} onOpenChange={setOpen} available={() => true} name={() => "a"} /></ConnectedProjectContext.Provider>;
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resume note" }));
  }
  fireEvent.input(await screen.findByRole("textbox", { name: "Note" }), { target: { value: text } });
  const original = structuredClone(notes.entries());
  const change = modal();

  await change(true);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull());
  await change(false);
  expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
  if (kind === "worktree") {
    fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
    await openFile();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resume note" }));
  }
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Note" })).value).toBe(text);
  expect(notes.entries()).toEqual(original);
  expect(app.calls.filter(call => call.method === "message.send")).toEqual([]);
});

it("u3295b_a_dialog_closes_outside_floating_controls: Terminal recipient menu", async () => {
  const view = await mountSend([agent("a", "idle", "waiting"), agent("b", "idle", "waiting")]);

  view.emulator.select("ls");
  fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: "keep recipient note" } });
  fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
  await screen.findByRole("menu");
  const change = modal();

  await change(true);
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await change(false);
  pressShortcut(view);
  expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" })).value).toBe("keep recipient note");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(view.calls()).toEqual([]);
});

it("u3295b_dialog_owned_controls_still_work: Start-after Todo picker", async () => {
  const { app } = await mountTodos([todo(1, { title: "Ship", owner: { kind: "user", id: "you", parent: null } }), todo(2, { title: "Docs" })]);
  const row = await screen.findByRole("button", { name: /#1 Ship/ });

  row.focus();
  fireEvent.keyDown(row, { key: "o", code: "KeyO" });
  fireEvent.click(within(await screen.findByRole("menu", { name: "Owners for #1" })).getByText("New Workstream…"));
  const dialog = within(await screen.findByRole("dialog", { name: "New Workstream" }));

  fireEvent.click(dialog.getByRole("radio", { name: "Start after another Todo" }));
  const trigger = await dialog.findByRole("button", { name: "Choose a Todo" });

  fireEvent.click(trigger);
  const input = await screen.findByRole("combobox");

  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole("dialog", { name: "New Workstream" })).toBeTruthy();
  fireEvent.click(trigger);
  await screen.findByRole("combobox");
  const change = modal();

  await change(true);
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  await change(false);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(todoCallsTo(app, "todo.startWorkstream")).toEqual([]);
});
