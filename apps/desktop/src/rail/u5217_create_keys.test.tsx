import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createSignal } from "solid-js";
import type { DaemonExit } from "../app/seam";
import { agent, workstream } from "../testing/nodes";
import { chooseFooter, mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

it("u5217_plus_opens_ordered_creation_choices", async () => {
  await mountRail([workstream("g")]);
  const plus = screen.getByRole("button", { name: "Create" });
  expect(plus.hasAttribute("aria-keyshortcuts")).toBe(false);
  fireEvent.click(plus);
  const items = await screen.findAllByRole("menuitem");
  expect(items.map(item => [item.textContent?.replace(/\s+/g, " ").trim(), item.getAttribute("aria-keyshortcuts")])).toEqual([
    ["Agent⌘N", "Meta+N"], ["Workstream⌥⌘N", "Alt+Meta+N"], ["Mode⇧⌘M", "Shift+Meta+M"],
  ]);
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
  screen.getByRole("menu").focus();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  const plus = screen.getByRole("button", { name: "Create" });
  expect(plus.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(plus);
  fireEvent.keyDown(plus, { key: "Enter" });
  expect(screen.queryByRole("menu")).toBeNull();
});
