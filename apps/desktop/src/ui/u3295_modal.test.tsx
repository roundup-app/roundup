import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { Popover } from "./Popover";
import { Menu } from "./Menu";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";
import { Combobox } from "./Combobox";
import { Mentions } from "./Mentions";
import { BlockerMenu } from "../todos/BlockerMenu";
import { todo } from "../todos/testHarness";

afterEach(() => { cleanup(); localStorage.clear(); });

const modal = (children?: () => JSX.Element) => {
  const [open, setOpen] = createSignal(false);

  render(() => <Dialog.Root open={open()} onOpenChange={({ open }) => setOpen(open)}>
    <Dialog.Content><Dialog.Title>Import</Dialog.Title><button>Inside</button>{children?.()}</Dialog.Content>
  </Dialog.Root>);

  return setOpen;
};

const surfaces = ["controlled", "uncontrolled", "outside opt-out", "menu", "select", "tooltip", "mentions", "blocker"] as const;

type Surface = typeof surfaces[number];

const mount = (kind: Surface) => {
  const picked = vi.fn();
  const [open, setOpen] = createSignal(false);
  const [text, setText] = createSignal("");
  const [dismissed, setDismissed] = createSignal(false);
  const [highlight, setHighlight] = createSignal<string | null>("alpha");
  const items = [{ value: "alpha", label: "Alpha" }];
  const results = () => !dismissed() && text() ? items.filter(item => item.label.toLowerCase().includes(text().slice(1).toLowerCase())) : [];

  const ui = () => {
    if (kind === "menu") return <Menu.Root onAction={picked}><Menu.Trigger>Open</Menu.Trigger><Menu.Content><Menu.Item value="alpha">Alpha</Menu.Item></Menu.Content></Menu.Root>;

    if (kind === "select") return <Select label="Open" choices={items} value="" onValueChange={picked} />;

    if (kind === "tooltip") return <Tooltip.Root delay={0} closeDelay={0}><Tooltip.Trigger>Open</Tooltip.Trigger><Tooltip.Content>Alpha</Tooltip.Content></Tooltip.Root>;

    if (kind === "mentions") return <Mentions.Root inputValue={text()} onDismiss={() => setDismissed(true)} items={results()} highlightedValue={highlight()} onHighlightChange={setHighlight} onSelect={picked}><Mentions.Field aria-label="Mention" value={text()} onInput={event => setText(event.currentTarget.value)} open onKey={() => {}} /><Mentions.List label="Suggestions" items={results()} row={item => item.label} /></Mentions.Root>;

    if (kind === "blocker") return <BlockerMenu open={open()} onOpenChange={setOpen} others={[todo(1, { title: "Alpha" })]} buttonRef={() => {}} onPick={picked} />;

    return <Popover.Root open={kind === "controlled" ? open() : undefined} onOpenChange={({ open }) => setOpen(open)} closeOnInteractOutside={kind === "outside opt-out" ? false : undefined}>
      <Popover.Trigger>Open</Popover.Trigger><Popover.Content><button onClick={() => picked("alpha")}>Alpha</button></Popover.Content>
    </Popover.Root>;
  };

  const show = async () => {
    const trigger = kind === "mentions" ? screen.getByRole("textbox", { name: "Mention" }) : screen.getByRole(kind === "select" ? "combobox" : "button", { name: kind === "blocker" ? /Blocker/ : "Open" });

    if (kind === "tooltip") { fireEvent.pointerEnter(trigger, { pointerType: "mouse" }); fireEvent.focus(trigger); }
    else if (kind === "mentions") { trigger.focus(); fireEvent.input(trigger, { target: { value: "@al" } }); }
    else fireEvent.click(trigger);

    if (kind === "select") await screen.findByRole("listbox");
    else if (kind === "tooltip") await screen.findByRole("tooltip");
    else await screen.findByText("Alpha");
  };

  return { ui, show, picked };
};

it.each(surfaces)("u3295b_a_dialog_closes_outside_floating_controls: %s", async kind => {
  const control = mount(kind);
  render(control.ui);
  await control.show();
  const setOpen = modal();

  const floating = () => kind === "tooltip" ? screen.queryByRole("tooltip")
    : kind === "menu" ? screen.queryByRole("menu", { hidden: true })
    : ["select", "mentions", "blocker"].includes(kind) ? screen.queryByRole("listbox")
    : screen.queryAllByRole("button").find(button => button.closest('[data-slot="popover-content"]')) ?? null;

  setOpen(true);
  await screen.findByRole("dialog", { name: "Import" });
  await waitFor(() => expect(floating()).toBeNull());
  await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
  setOpen(false);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(floating()).toBeNull();
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
  fireEvent.pointerEnter(screen.getByRole("button", { name: "Open", hidden: true }), { pointerType: "mouse" });
  // Observe past the Tooltip's zero-delay scheduled opening without moving focus outside the modal.
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("u3295b_dialog_owned_controls_still_work: nested portalled Dialog", async () => {
  const control = mount("menu");

  render(() => <Dialog.Root open><Dialog.Content>
    <Dialog.Title>Outer</Dialog.Title>
    <Dialog.Root open><Dialog.Content>
      <Dialog.Title>Active</Dialog.Title>{control.ui()}
    </Dialog.Content></Dialog.Root>
  </Dialog.Content></Dialog.Root>);
  await screen.findByRole("dialog", { name: "Active" });
  await control.show();
  fireEvent.click(screen.getByText("Alpha"));
  await waitFor(() => expect(control.picked).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("dialog", { name: "Active" })).toBeTruthy();
});


it("u504_form_suggestions_highlight_wrap_and_accept_without_moving_focus", async () => {
  const picked = vi.fn();
  render(() => <Combobox.Picker label="Destination" value="" items={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} onSelect={picked} />);
  const trigger = screen.getByRole("button", { name: /Destination/ });
  fireEvent.click(trigger);
  const field = await screen.findByRole("combobox");
  await waitFor(() => expect(document.activeElement).toBe(field));
  const options = screen.getAllByRole("option");
  const active = () => document.getElementById(field.getAttribute("aria-activedescendant") ?? "");
  await waitFor(() => expect(active()).toBe(options[0]));
  fireEvent.keyDown(field, { key: "ArrowUp" });
  await waitFor(() => expect(active()).toBe(options[1]));
  fireEvent.keyDown(field, { key: "ArrowDown" });
  await waitFor(() => expect(active()).toBe(options[0]));
  fireEvent.input(field, { target: { value: "Al" } });
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
  await waitFor(() => expect(active()).toBe(screen.getByRole("option")));
  fireEvent.input(field, { target: { value: "" } });
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
  const last = screen.getAllByRole("option")[1]!;
  fireEvent.pointerMove(last, { pointerType: "mouse" });
  await waitFor(() => expect(active()).toBe(options[0]));
  expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "Tab" });
  await waitFor(() => expect(picked).toHaveBeenCalledExactlyOnceWith("a"));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("u504_form_suggestions_home_and_end_move_the_highlight_to_the_first_and_last", async () => {
  render(() => <Combobox.Picker label="Destination" value="" items={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Destination/ }));
  const field = await screen.findByRole("combobox");
  const options = () => screen.getAllByRole("option");
  const active = () => document.getElementById(field.getAttribute("aria-activedescendant") ?? "");
  await waitFor(() => expect(active()).toBe(options()[0]));
  expect(fireEvent.keyDown(field, { key: "End" })).toBe(false);
  await waitFor(() => expect(active()).toBe(options()[2]));
  fireEvent.keyDown(field, { key: "Home" });
  await waitFor(() => expect(active()).toBe(options()[0]));
});

it("u504_a_pick_returns_focus_to_the_field_unless_a_newer_choice_moved_it", async () => {
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>("a");
  const picked = vi.fn();
  render(() => <>
    <button>Elsewhere</button>
    <Combobox.Root items={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} inputValue={query()} onInput={setQuery} highlightedValue={highlight()} onHighlightChange={setHighlight}
      onSelect={picked} label="Query" placeholder="" empty="" row={item => item.label} />
  </>);
  const field = await screen.findByRole("combobox");
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  await waitFor(() => expect(document.activeElement).toBe(field));

  elsewhere.focus();
  fireEvent.click(screen.getAllByRole("option")[1]!);
  await waitFor(() => expect(picked).toHaveBeenCalledWith("b"));
  await waitFor(() => expect(document.activeElement).toBe(field));

  fireEvent.click(screen.getAllByRole("option")[0]!);
  await waitFor(() => expect(picked).toHaveBeenCalledTimes(2));
  elsewhere.focus();
  await frame();
  await frame();
  expect(document.activeElement).toBe(elsewhere);
});
