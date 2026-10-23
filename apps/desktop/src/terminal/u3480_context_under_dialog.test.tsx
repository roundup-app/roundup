import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "../ui/Dialog";
import { agent } from "../testing/nodes";
import { callsTo } from "./paneHarness";
import { fireEvent, mountSend, screen, waitFor } from "./sendHarness";

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

const selected = "original Terminal selection\nsecond line";

const openContext = async (container: HTMLElement) => {
  fireEvent.contextMenu(container.querySelector(".pane-screen")!, { clientX: 5, clientY: 5 });
  const menu = await screen.findByRole("menu");

  await waitFor(() => expect(document.activeElement).toBe(menu));

  return menu;
};

const openModal = async () => {
  const view = await mountSend([agent("a", "idle", "waiting")]);
  const readText = vi.fn(async () => "clipboard");
  const writeText = vi.fn(async (_text: string) => {});

  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText, writeText } });
  view.emulator.select(selected);
  await screen.findByRole("textbox", { name: "Add a note (optional)" });
  const menu = await openContext(view.container);
  const [open, setOpen] = createSignal(false);

  render(() => <Dialog.Root open={open()} onOpenChange={({ open }) => setOpen(open)}>
    <Dialog.Positioner><Dialog.Content><Dialog.Title>Import</Dialog.Title><button>Inside</button></Dialog.Content></Dialog.Positioner>
  </Dialog.Root>);
  setOpen(true);
  const dialog = await screen.findByRole("dialog", { name: "Import" });

  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

  return { view, menu, setOpen, readText, writeText };
};

it("u3480_a_modal_closes_the_pane_context_menu", async () => {
  const { view, menu, readText, writeText } = await openModal();

  await waitFor(() => expect(screen.queryByRole("menu", { hidden: true })).toBeNull());
  expect(screen.queryByRole("menuitem", { hidden: true })).toBeNull();
  expect(menu.isConnected).toBe(false);
  menu.focus();
  expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  expect(readText).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  expect(callsTo(view.app, "terminal.write")).toEqual([]);
  expect(view.calls()).toEqual([]);
});

it("u3480_closing_the_dialog_keeps_the_context_menu_closed", async () => {
  const { view, setOpen, readText, writeText } = await openModal();

  await waitFor(() => expect(screen.queryByRole("menu", { hidden: true })).toBeNull());
  setOpen(false);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
  expect(readText).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  expect(callsTo(view.app, "terminal.write")).toEqual([]);
  expect(view.calls()).toEqual([]);
});

it("u3480_the_pane_context_menu_works_after_modal_dismissal", async () => {
  const { view, setOpen, writeText } = await openModal();

  await waitFor(() => expect(screen.queryByRole("menu", { hidden: true })).toBeNull());
  setOpen(false);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await openContext(view.container);
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(selected));
  expect(writeText).toHaveBeenCalledTimes(1);
});
