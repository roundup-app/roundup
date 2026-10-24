import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { Combobox } from "../ui/Combobox";
import { info } from "../testing/nodes";
import { openSwitcher, field, mountSwitcher, press, rows } from "./switcherFixture";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const type = (text: string) => fireEvent.input(field()!, { target: { value: text } });

describe("u529 ⌘K switches to an Agent or Terminal by name", () => {
  it("u529_cmd_k_lists_agents_doors_groups_and_terminals_and_filters_as_you_type", async () => {
    await mountSwitcher();
    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());

    expect(document.activeElement).toBe(field());
    // error, then needs-you, then Rail order; the Terminal last with its Workstream's name.
    expect(rows()).toEqual(["Cy", "Bob", "lead", "Ann", "ops", "Dee", "build shell ops"]);

    type("AN");
    await waitFor(() => expect(rows()).toEqual(["Ann"]));

    type("zzz");
    await waitFor(() => expect(document.querySelector(".switcher")!.textContent).toContain("No match"));
    expect(rows()).toEqual([]);
  });

  it("u529_enter_on_an_agent_selects_it_and_focuses_the_pane", async () => {
    const { connected } = await mountSwitcher();

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("dee");
    await waitFor(() => expect(rows()).toEqual(["Dee"]));
    press("Enter", {}, field()!);

    await waitFor(() => expect(connected.rail.selected()).toBe("dee"));
    expect(field()).toBeNull();
    expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
  });

  it("u529_enter_on_a_terminal_shows_its_bubble_and_focuses_its_emulator", async () => {
    const { connected } = await mountSwitcher();

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("build");
    await waitFor(() => expect(rows()).toEqual(["build shell ops"]));
    press("Enter", {}, field()!);

    await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
    await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("7"));
  });

  it("u524_the_switcher_restores_a_project_terminal_at_the_project_root", async () => {
    const { connected } = await mountSwitcher("dee", undefined, [info("8", { owner: "/p", title: "project shell" })]);

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    type("project shell");
    press("Enter", {}, field()!);

    await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("8"));
    expect(connected.rail.selected()).toBeNull();
  });

  it("u529_escape_returns_focus_and_calls_nothing", async () => {
    const { app } = await mountSwitcher();
    const origin = document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!;

    origin.focus();

    const calls = app.calls.length;

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    press("Escape", {}, field()!);

    await waitFor(() => expect(field()).toBeNull());
    expect(document.activeElement).toBe(origin);
    expect(app.calls.length).toBe(calls);
  });
});

it("u2773a_queries_controlled_input_restores_without_execution", async () => {
  const { app, connected } = await mountSwitcher("ann");
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(true);
  const [highlighted, setHighlighted] = createSignal<string | null>("dee");
  const select = vi.fn((value: string) => connected.rail.select(value));
  const exact = "  e\u0301 🧭 東京  ";
  const items = [{ value: "dee", label: exact }, { value: "ann", label: "other" }];
  let input!: HTMLInputElement;

  const view = render(() => <Show when={open()}><Combobox.Root items={items.filter((item) => item.label.includes(query()))}
    inputValue={query()} inputRef={(element) => { input = element; }}
    highlightedValue={highlighted()} onHighlightChange={setHighlighted} onInput={setQuery} onSelect={select}
    label="Query" placeholder="" empty="" row={(item) => item.label} /></Show>);

  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.input(input, { target: { value: exact } });
  input.setSelectionRange(2, 9, "backward");
  const selection = { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
  const origin = document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!;
  origin.focus();
  const calls = app.calls.length;

  setQuery("");
  await waitFor(() => expect(input.value).toBe(""));
  setQuery(exact);
  await waitFor(() => expect(input.value).toBe(exact));
  expect([...view.container.querySelectorAll('[role="option"]')].map((row) => row.getAttribute("data-value"))).toEqual(["dee"]);
  expect(document.activeElement).toBe(origin);

  // Explicit reopening remounts the field; the owner restores selection through the fresh native ref.
  const previous = input;
  setOpen(false);
  setOpen(true);
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input).not.toBe(previous);
  input.focus();
  input.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 9, "backward"]);
  expect(input.value).toBe(exact);
  expect(document.activeElement).toBe(input);
  expect(select).not.toHaveBeenCalled();
  expect(connected.rail.selected()).toBe("ann");
  expect(app.calls.length).toBe(calls);
});


it("u2773a_queries_restores_exact_work", async () => {
  const { app, connected } = await mountSwitcher("ann");
  const exact = "  e\u0301 🧭 東京  ";
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  type(exact);
  field()!.setSelectionRange(2, 9, "backward");
  press("Escape", {}, field()!);
  const calls = app.calls.length;
  openSwitcher();
  await waitFor(() => expect(field()?.value).toBe(exact));
  await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 9, "backward"]));
  expect(connected.rail.selected()).toBe("ann");
  expect(app.calls.length).toBe(calls);

  cleanup();
  const reopened = await mountSwitcher("ann");
  const origin = document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')!;
  origin.focus();
  const reopenedCalls = reopened.app.calls.length;
  await Promise.resolve();
  expect(document.activeElement).toBe(origin);
  expect(field()).toBeNull();
  openSwitcher();
  await waitFor(() => expect(field()?.value).toBe(exact));
  await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 9, "backward"]));
  expect(reopened.app.calls.length).toBe(reopenedCalls);
});


it.each(["write", "read", "invalid"])("u2773e_recovery_actions_keep_surface_draft_%s", async (failure) => {
  const key = "roundup:drafts:/p";
  const exact = "  e\u0301 🧭 東京  ";
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

  if (failure === "invalid") localStorage.setItem(key, "{broken");

  const read = failure === "read" ? vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); }) : null;
  const { app } = await mountSwitcher();
  const write = failure === "write" ? vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); }) : null;
  const calls = app.calls.length;
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  type(exact);
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(field()!.value).toBe(exact);
  fireEvent.click(screen.getByRole("button", { name: "Copy query" }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith(exact));
  expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();

  if (failure === "invalid") expect(localStorage.getItem(key)).toBe("{broken");

  read?.mockRestore();
  write?.mockRestore();

  if (failure === "invalid") localStorage.removeItem(key);

  field()!.setSelectionRange(2, 9, "backward");
  screen.getByRole("button", { name: "Try again" }).focus();
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(JSON.parse(localStorage.getItem(key)!).drafts.at(-1).value.query).toBe(exact);
  expect(field()!.value).toBe(exact);
  expect(document.activeElement).toBe(field());
  expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 9, "backward"]);
  expect(app.calls.length).toBe(calls);

  const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  type("newer query");
  await screen.findByRole("alert");
  refuse.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Discard query" }));
  expect(field()!.value).toBe("");
  expect(JSON.parse(localStorage.getItem(key)!).drafts).toEqual([]);
  expect(app.calls.length).toBe(calls);
});

// The U2773a Project/reload observers run in testing/u375_real_daemon.test.tsx,
// whose Daemon launches use the existing N7 inventory and cleanup contract.

it("u2773e_unreadable_query_offers_only_retry_until_there_is_text", async () => {
  localStorage.setItem("roundup:drafts:/p", "{broken");
  await mountSwitcher();
  openSwitcher();
  await screen.findByRole("alert");
  expect(field()!.value).toBe("");
  expect(screen.queryByRole("button", { name: "Copy query" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Discard query" })).toBeNull();
  expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  type("recoverable");
  expect(screen.getByRole("button", { name: "Copy query" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Discard query" })).toBeDefined();
});
