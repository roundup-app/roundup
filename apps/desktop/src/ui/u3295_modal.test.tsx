import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { Popover } from "./Popover";
import { Menu } from "./Menu";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";
import { Mentions } from "./Mentions";
import { BlockerMenu } from "../todos/BlockerMenu";
import { todo } from "../todos/testHarness";

afterEach(() => { cleanup(); localStorage.clear(); });

const modal = (children?: () => JSX.Element) => {
  const [open, setOpen] = createSignal(false);

  render(() => <Dialog.Root open={open()} onOpenChange={({ open }) => setOpen(open)}>
    <Portal><Dialog.Positioner><Dialog.Content><Dialog.Title>Import</Dialog.Title><button>Inside</button>{children?.()}</Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>);

  return setOpen;
};

const surfaces = ["controlled", "uncontrolled", "outside opt-out", "menu", "select", "tooltip", "mentions", "blocker"] as const;

type Surface = typeof surfaces[number];

const mount = (kind: Surface) => {
  const picked = vi.fn();
  const [open, setOpen] = createSignal(false);
  const [text, setText] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>("alpha");
  const items = [{ value: "alpha", label: "Alpha" }];
  const results = () => text() ? items.filter(item => item.label.toLowerCase().includes(text().slice(1).toLowerCase())) : [];

  const ui = () => {
    if (kind === "menu") return <Menu.Root onSelect={picked}><Menu.Trigger>Open</Menu.Trigger><Portal><Menu.Positioner><Menu.Content><Menu.Item value="alpha">Alpha</Menu.Item></Menu.Content></Menu.Positioner></Portal></Menu.Root>;

    if (kind === "select") return <Select label="Open" choices={items} value="" onValueChange={picked} />;

    if (kind === "tooltip") return <Tooltip.Root openDelay={0} closeDelay={0}><Tooltip.Trigger>Open</Tooltip.Trigger><Portal><Tooltip.Positioner><Tooltip.Content>Alpha</Tooltip.Content></Tooltip.Positioner></Portal></Tooltip.Root>;

    if (kind === "mentions") return <Mentions.Root items={results()} highlightedValue={highlight()} onHighlightChange={setHighlight} onSelect={picked}><Mentions.Field aria-label="Mention" value={text()} onInput={event => setText(event.currentTarget.value)} open onKey={() => {}} /><Mentions.List label="Suggestions" items={results()} /></Mentions.Root>;

    if (kind === "blocker") return <BlockerMenu open={open()} onOpenChange={setOpen} others={[todo(1, { title: "Alpha" })]} buttonRef={() => {}} onPick={picked} />;

    return <Popover.Root open={kind === "controlled" ? open() : undefined} onOpenChange={({ open }) => setOpen(open)} closeOnInteractOutside={kind === "outside opt-out" ? false : undefined}>
      <Popover.Trigger>Open</Popover.Trigger><Portal><Popover.Positioner><Popover.Content><button onClick={() => picked("alpha")}>Alpha</button></Popover.Content></Popover.Positioner></Portal>
    </Popover.Root>;
  };

  const show = async () => {
    const trigger = kind === "mentions" ? screen.getByRole("textbox", { name: "Mention" }) : screen.getByRole(kind === "select" ? "combobox" : "button", { name: kind === "blocker" ? /Blocker/ : "Open" });

    if (kind === "tooltip") { fireEvent.pointerOver(trigger, { pointerType: "mouse" }); fireEvent.focus(trigger); }
    else if (kind === "mentions") { trigger.focus(); fireEvent.input(trigger, { target: { value: "@al" } }); }
    else fireEvent.click(trigger);

    if (kind === "select") await screen.findByRole("listbox");
    else await screen.findByText("Alpha");
  };

  return { ui, show, picked };
};

it.each(surfaces)("u3295b_a_dialog_closes_outside_floating_controls: %s", async kind => {
  const control = mount(kind);
  render(control.ui);
  await control.show();
  const setOpen = modal();

  setOpen(true);
  await screen.findByRole("dialog", { name: "Import" });
  await waitFor(() => expect(kind === "select" ? screen.queryByRole("listbox") : screen.queryByText("Alpha")).toBeNull());
  await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
  setOpen(false);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(kind === "select" ? screen.queryByRole("listbox") : screen.queryByText("Alpha")).toBeNull();
  expect(control.picked).not.toHaveBeenCalled();

  if (kind === "mentions") expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("@al");
});

it.each(["menu", "select", "tooltip", "mentions", "blocker"] as const)("u3295b_dialog_owned_controls_still_work: %s", async kind => {
  const control = mount(kind);
  const setOpen = modal(control.ui);

  setOpen(true);
  await screen.findByRole("dialog");
  await control.show();

  if (kind !== "tooltip") {
    const choice = kind === "select" ? within(screen.getByRole("listbox")).getByRole("option", { name: "Alpha" }) : screen.getByText("Alpha");
    fireEvent.pointerDown(choice, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(choice, { pointerType: "mouse", button: 0 });
    fireEvent.click(choice);
    await waitFor(() => expect(control.picked).toHaveBeenCalledTimes(1));
  }

  expect(screen.getByRole("dialog", { name: "Import" })).toBeTruthy();
});

it("u3295b_background_tooltips_stay_closed", async () => {
  const control = mount("tooltip");
  render(control.ui);
  const setOpen = modal();

  setOpen(true);
  await screen.findByRole("dialog");
  fireEvent.pointerOver(screen.getByRole("button", { name: "Open", hidden: true }), { pointerType: "mouse" });
  // Observe past the Tooltip's zero-delay scheduled opening without moving focus outside the modal.
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByRole("tooltip")).toBeNull();
});
