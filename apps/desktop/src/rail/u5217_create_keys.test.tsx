import { appSettings, saveAppSettings } from "../settings/preferences";
import { ariaChord, CHORDS } from "../keys/chords";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createSignal } from "solid-js";
import type { DaemonExit } from "../app/seam";
import { agent, workstream } from "../testing/nodes";
import { chooseFooter, mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

it("u5217_plus_opens_ordered_creation_choices", async () => {
  await mountRail([workstream("g")]);
  const plus = screen.getByRole("button", { name: "Create" });
  expect(within(document.querySelector<HTMLElement>(".rail-actions")!).getAllByRole("button")).toHaveLength(1);
  expect(plus.hasAttribute("aria-keyshortcuts")).toBe(false);
  fireEvent.click(plus);
  const items = await screen.findAllByRole("menuitem");
  expect(items.map(item => item.getAttribute("data-value"))).toEqual(["agent", "workstream", "mode"]);

  for (const [index, name] of (["agent.new", "workstream.new", "mode.new"] as const).entries()) {
    expect(items[index]!.querySelector("kbd")?.textContent).toBe(CHORDS[name].keys);
    expect(items[index]!.getAttribute("aria-keyshortcuts")).toBe(ariaChord(CHORDS[name]));
  }

  const before = appSettings().shortcuts;

  try {
    await saveAppSettings({ shortcuts: { ...before, "workstream.new": "ctrl+meta+KeyW" } });
    expect(items[1]!.querySelector("kbd")?.textContent).toBe(CHORDS["workstream.new"].keys);
    expect(items[1]!.getAttribute("aria-keyshortcuts")).toBe(ariaChord(CHORDS["workstream.new"]));
  } finally {
    await saveAppSettings({ shortcuts: before });
  }
});

it("u5217_opening_the_menu_starts_nothing", async () => {
  const m = await mountRail([workstream("g")]);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("menu");
  expect(railCallsTo(m.app, "agent.spawn")).toEqual([]);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([null, "g", "a"])("u5217_a_menu_choice_runs_the_action_its_chord_runs_in_%s", async selected => {
  for (const [kind, init] of [
    ["Agent", { key: "n", code: "KeyN", metaKey: true }],
    ["Workstream", { key: "n", code: "KeyN", metaKey: true, altKey: true }],
    ["Mode", { key: "M", code: "KeyM", metaKey: true, shiftKey: true }],
  ] as const) {
    const outcomes = [];

    for (const menu of [true, false]) {
      const tree = [workstream("g"), agent("a", "idle", "idle", { parent: "g" })];
      const m = await mountRail(tree);
      m.rail.select(selected);
      m.app.handlers["agent.spawn"] = () => { const made = agent("made", "idle", "idle"); tree.push(made);

 return made; };

      m.app.handlers["rail.createWorkstream"] = () => { const made = workstream("made"); tree.push(made);

 return made; };

      if (menu) await chooseFooter(kind);
      else fireEvent.keyDown(document, init);

      if (kind === "Mode") await screen.findByRole("dialog");
      else await waitFor(() => expect(m.rail.selected()).toBe("made"));
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      outcomes.push({ calls: m.app.calls.filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method)), selected: m.rail.selected(), dialog: !!screen.queryByRole("dialog"), focus: document.activeElement?.getAttribute("data-id") ?? document.activeElement?.getAttribute("name") });
      cleanup();
    }

    expect(outcomes[0]).toEqual(outcomes[1]);
  }
});

it.each(["Enter", " "])("u5555_keyboard_opens_chooses_and_returns_focus_%s", async key => {
  const m = await mountRail([workstream("g")]);
  const plus = screen.getByRole("button", { name: "Create" });
  plus.focus();
  fireEvent.keyDown(plus, { key });
  const menu = await screen.findByRole("menu");
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(plus));
  expect(railCallsTo(m.app, "agent.spawn")).toEqual([]);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
});

it("u5555_unavailable_creation_cannot_run_from_the_menu", async () => {
  const [exited, setExited] = createSignal<DaemonExit | null>(null);
  const m = await mountRail([workstream("g")], [], exited);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("menu");
  setExited({ code: 1 });

  for (const item of screen.getAllByRole("menuitem")) {
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    fireEvent.keyDown(item, { key: "Enter" });
  }

  expect(railCallsTo(m.app, "agent.spawn")).toEqual([]);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
  cleanup();
  await mountRail([workstream("g")], [], exited);
  const plus = screen.getByRole("button", { name: "Create" });
  expect(plus.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(plus);
  fireEvent.keyDown(plus, { key: "Enter" });
  expect(screen.queryByRole("menu")).toBeNull();
});

it.each(["pointer", "Enter", " "])("u5629_open_and_escape_keep_the_failed_start_%s", async opening => {
  const m = await mountRail([workstream("g")]);
  m.rail.select("g");
  m.app.handlers["agent.spawn"] = () => { throw new Error("Spawn refused. Check setup and retry."); };

  fireEvent.keyDown(document, { key: "n", metaKey: true });
  const failure = await screen.findByRole("alert");
  await screen.findByText("Spawn refused. Check setup and retry.");
  const retry = screen.getByRole("button", { name: "Retry" });
  expect(retry.isConnected).toBe(true);
  const plus = screen.getByRole("button", { name: "Create" });

  if (opening === "pointer") fireEvent.click(plus);
  else {
    plus.focus();
    fireEvent.keyDown(plus, { key: opening });
  }

  const menu = await screen.findByRole("menu");
  await waitFor(() => expect(document.activeElement).toBe(menu));
  expect(screen.getByRole("alert")).toBe(failure);
  expect(retry.isConnected).toBe(true);
  expect(railCallsTo(m.app, "agent.spawn")).toHaveLength(1);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(m.rail.selected()).toBe("g");
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(plus));
  expect(screen.getByRole("alert")).toBe(failure);
  expect(retry.isConnected).toBe(true);
  expect(railCallsTo(m.app, "agent.spawn")).toHaveLength(1);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(m.rail.selected()).toBe("g");
});

it("u5629_retry_after_escape_repeats_only_the_failed_start", async () => {
  const tree = [workstream("g")];
  const m = await mountRail(tree);
  m.rail.select("g");
  m.app.handlers["agent.spawn"] = () => { throw new Error("Spawn refused. Check setup and retry."); };

  fireEvent.keyDown(document, { key: "n", metaKey: true });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const menu = await screen.findByRole("menu");
  await waitFor(() => expect(document.activeElement).toBe(menu));
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create" })));
  m.app.handlers["agent.spawn"] = () => {
    const made = agent("made", "idle", "idle", { parent: "g" });
    tree.push(made);

    return made;
  };

  const retry = screen.getByRole("button", { name: "Retry" });
  fireEvent.click(retry);
  await waitFor(() => expect(m.rail.selected()).toBe("made"));
  const calls = railCallsTo(m.app, "agent.spawn");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(retry.isConnected).toBe(false);
});

it("u5629_dismiss_after_escape_clears_only_feedback", async () => {
  const m = await mountRail([workstream("g")]);
  m.rail.select("g");
  const draft = m.connected.drafts.edit({ surface: "ask", object: "ask-bar", recipient: "g" }, { text: " unfinished draft " }, null, "ordinary").draft;
  m.app.handlers["agent.spawn"] = () => { throw new Error("Spawn refused. Check setup and retry."); };

  fireEvent.keyDown(document, { key: "n", metaKey: true });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const menu = await screen.findByRole("menu");
  await waitFor(() => expect(document.activeElement).toBe(menu));
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create" })));
  const retry = screen.getByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(retry.isConnected).toBe(false);
  expect(railCallsTo(m.app, "agent.spawn")).toHaveLength(1);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
  expect(m.rail.selected()).toBe("g");
  expect(m.connected.drafts.list()).toContainEqual(draft);
});
