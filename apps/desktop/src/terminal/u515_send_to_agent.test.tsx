import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { CHORDS } from "../keys/chords";
import { agent, workstream } from "../testing/nodes";
import { control, fireEvent, mountSend, pressShortcut, screen, waitFor } from "./sendHarness";

afterEach(() => { cleanup(); window.localStorage.clear(); });

const AGENTS = [agent("a", "idle", "waiting"), agent("b", "working", "busy")];

it("u515_send_to_agent_is_offered_for_any_selection_in_three_places", async () => {
  const view = await mountSend(AGENTS);

  view.emulator.select("ls\nfile");

  // By the selection, without taking the keyboard from the Terminal.
  await waitFor(() => expect(control()).not.toBeNull());
  expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Add a note (optional)" }));

  // The context menu, beside Copy and Paste.
  fireEvent.contextMenu(view.container.querySelector(".pane-screen")!, { clientX: 5, clientY: 5 });
  expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Copy", "Paste", "Send to agent"]);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menu")));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  // The shortcut, which puts the keyboard in the note.
  pressShortcut(view);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Add a note (optional)" })));
});

it("u515_no_selection_offers_nothing", async () => {
  const view = await mountSend(AGENTS);

  expect(control()).toBeNull();
  fireEvent.contextMenu(view.container.querySelector(".pane-screen")!, { clientX: 5, clientY: 5 });
  expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Paste"]);
  pressShortcut(view);
  expect(screen.queryByRole("textbox", { name: "Add a note (optional)" })).toBeNull();
});

it("u515_the_shortcut_conflicts_with_no_other_binding", () => {
  expect(CHORDS.flatMap((chord) => chord.presses)).not.toContain("meta+shift+KeyA");
});

it("u515_the_list_holds_only_running_agents_in_rail_order", async () => {
  const view = await mountSend([
    agent("b", "working", "busy", { name: "Beta", order: 1 }),
    agent("a", "idle", "waiting", { name: "Alpha", order: 0 }),
    agent("d", "done", "finished", { name: "Done one", order: 2 }),
    workstream("w", { name: "Group", order: 3 }),
  ]);

  view.emulator.select("ls");
  fireEvent.click(await screen.findByRole("button", { name: "Send to agent" }));
  expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Alpha", "Beta"]);
  expect(view.calls()).toEqual([]);
});

it("u515_one_agent_receives_without_a_menu", async () => {
  const view = await mountSend([agent("a", "idle", "waiting", { name: "Alpha" }), agent("d", "done", "finished")]);

  view.emulator.select("ls");
  fireEvent.click(await screen.findByRole("button", { name: "Send to agent" }));
  await waitFor(() => expect(view.calls().map((call) => call.to)).toEqual(["a"]));
  expect(screen.queryByRole("menuitem")).toBeNull();
});

it("u515_several_agents_open_a_menu_and_a_pick_sends", async () => {
  const view = await mountSend(AGENTS);

  view.emulator.select("ls");
  fireEvent.click(await screen.findByRole("button", { name: "Send to agent" }));
  const menu = await screen.findByRole("menu");

  await waitFor(() => expect(document.activeElement).toBe(menu));
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
  expect(view.calls()).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "b" }));
  await waitFor(() => expect(view.calls().map((call) => call.to)).toEqual(["b"]));
});

it("u515_no_agent_disables_the_control", async () => {
  const view = await mountSend([agent("d", "done", "finished")]);

  view.emulator.select("ls");

  const button = await screen.findByRole("button", { name: "Send to agent" });

  expect(button.hasAttribute("title")).toBe(false);
  fireEvent.pointerMove(button);
  expect((await screen.findByRole("tooltip")).textContent).toBe("No running agent");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(view.calls()).toEqual([]);
});

it("u515_a_note_goes_with_the_excerpt", async () => {
  const view = await mountSend([agent("a", "idle", "waiting")]);

  view.emulator.select("ls");
  fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: "why does this fail?" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Add a note (optional)" }), { key: "Enter" });
  await waitFor(() => expect(view.calls()).toHaveLength(1));
  expect(view.calls()[0]!.body.startsWith("why does this fail?\n\n```\nls\n```")).toBe(true);
});

it("u515_an_empty_note_adds_nothing", async () => {
  const view = await mountSend([agent("a", "idle", "waiting")]);

  view.emulator.select("ls");
  fireEvent.keyDown(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { key: "Enter", shiftKey: true });
  expect(view.calls()).toEqual([]);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Add a note (optional)" }), { key: "Enter" });
  await waitFor(() => expect(view.calls()).toHaveLength(1));
  expect(view.calls()[0]!.body).toBe("```\nls\n```");
});

it("u515_the_note_is_capped_at_280_characters", async () => {
  const view = await mountSend([agent("a", "idle", "waiting")]);

  view.emulator.select("ls");

  const note = await screen.findByRole("textbox", { name: "Add a note (optional)" });

  expect(note.getAttribute("maxlength")).toBe("280");
  fireEvent.input(note, { target: { value: "x".repeat(400) } });
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" }).value).toHaveLength(280);
});

it("u515_the_menu_item_and_shortcut_open_the_control_focused", async () => {
  const view = await mountSend(AGENTS);

  view.emulator.select("ls");
  await screen.findByRole("textbox", { name: "Add a note (optional)" });
  fireEvent.contextMenu(view.container.querySelector(".pane-screen")!, { clientX: 5, clientY: 5 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Send to agent" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Add a note (optional)" })));
});

it("u515_a_blank_selection_is_not_sent", async () => {
  const view = await mountSend([agent("a", "idle", "waiting")]);

  view.emulator.select("   \n  ");
  fireEvent.click(await screen.findByRole("button", { name: "Send to agent" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Nothing selected");
  expect(view.calls()).toEqual([]);
});
