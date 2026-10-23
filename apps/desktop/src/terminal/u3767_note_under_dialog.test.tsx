import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { Dialog } from "../ui/Dialog";
import { agent } from "../testing/nodes";
import { fireEvent, mountSend, screen, waitFor } from "./sendHarness";

afterEach(() => { cleanup(); window.localStorage.clear(); });

const NOTE = "Add a note (optional)";

const openNote = async () => {
  const view = await mountSend([agent("a", "idle", "waiting")]);

  view.emulator.select("ls");
  const note = await screen.findByRole("textbox", { name: NOTE });

  fireEvent.input(note, { target: { value: "unsent words" } });

  const [open, setOpen] = createSignal(false);

  render(() => <Dialog.Root open={open()} onOpenChange={(change) => setOpen(change.open)}>
    <Dialog.Positioner><Dialog.Content><Dialog.Title>Import</Dialog.Title></Dialog.Content></Dialog.Positioner>
  </Dialog.Root>);

  return { view, setOpen };
};

it("u3767_opening_a_dialog_closes_the_note_popover", async () => {
  const { setOpen } = await openNote();

  setOpen(true);
  await screen.findByRole("dialog");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: NOTE })).toBeNull());
});

it("u3767_the_note_text_survives_the_dialog", async () => {
  const { view, setOpen } = await openNote();

  setOpen(true);
  await screen.findByRole("dialog");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: NOTE })).toBeNull());
  setOpen(false);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  view.container.querySelector<HTMLElement>("[data-terminal]")!.focus();
  view.container.querySelector<HTMLElement>("[data-terminal]")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a", code: "KeyA", metaKey: true, shiftKey: true }));
  expect(await screen.findByDisplayValue("unsent words")).toBe(await screen.findByRole("textbox", { name: NOTE }));
});
