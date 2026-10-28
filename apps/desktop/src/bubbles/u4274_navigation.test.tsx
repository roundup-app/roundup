import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage } from "../testing/menuProbe";
import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { openSwitcher } from "../switcher/switcherFixture";
import { agent, info } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each(["keyboard", "menu", "command"].flatMap(source => ["home", "a1", null, "empty"].map(selection => ({ source, selection }))))("u4453c_new_terminal_and_hints_without_a_bar: $source $selection", async ({ source, selection }) => {
  const { daemon, connected, shells, emulators } = await mountNavigation(selection === "empty");

  if (selection !== "empty") connected().rail.select(selection);

  const owner = selection === "empty" ? null : "home";
  daemon.handlers["terminal.open"] = () => { shells.push(info("shell", { owner: owner ?? "/p" }));

    return { terminal_id: "shell" }; };

  if (source === "keyboard") window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  else if (source === "menu") openProjectPage("action:chord:⌘T", "/p");
  else {
    openSwitcher();
    const field = await screen.findByRole("combobox", { name: "Go to" });
    fireEvent.input(field, { target: { value: "New Terminal" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  }
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: owner }]);
  expect(daemon.calls.filter(call => ["rail.createWorkstream", "rail.startDoor", "agent.spawn"].includes(call.method))).toHaveLength(0);
  expect(emulators.made.has("shell")).toBe(true);
  expect(document.querySelector('.bubble[data-bubble="shell"]')).not.toBeNull();
  expect(document.querySelector(".terminal-tabs")).toBeNull();
});

it("u4313a_rail_footer_offers_workstream_and_agent", async () => {
  await mountNavigation(true);
  const footer = document.querySelector<HTMLElement>(".rail-actions")!;
  expect(within(footer).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Add Workstream", "New Agent"]);
});

it.each(["keyboard", "footer"].flatMap(source => ["home", "a1", null, "empty"].map(selection => ({ source, selection }))))("u4313a_rail_agent_uses_the_new_agent_action: $source $selection", async ({ source, selection }) => {
  const { daemon, connected, nodes } = await mountNavigation(selection === "empty");

  if (selection !== "empty") connected().rail.select(selection);
  const parent = selection === "home" ? "home" : null;
  daemon.handlers["agent.spawn"] = () => {
    const spawned = agent("fresh", "idle", "starting", { parent });
    nodes.push(spawned);
    queueMicrotask(() => daemon.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" }));

    return spawned;
  };

  if (source === "keyboard") window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, bubbles: true }));
  else fireEvent.click(within(document.querySelector<HTMLElement>(".rail-actions")!).getByRole("button", { name: "New Agent" }));
  await waitFor(() => expect(connected().rail.selected()).toBe("fresh"));
  expect(daemon.calls.filter(call => ["agent.spawn", "terminal.open", "rail.createWorkstream"].includes(call.method))).toEqual([
    { method: "agent.spawn", params: { cwd: "/p", prompt: null, parent, model: null, effort: null } },
  ]);
});

it("u4453c_command_menu_restores_and_closes_each_terminal", async () => {
  const { daemon, connected, shells } = await mountNavigation();
  shells.push(info("101", { owner: "a1", title: "cargo test" }), info("102", { owner: "a1", title: "tail -f build.log" }));
  connected().rail.select("a1");
  await connected().rail.refresh({ terminals: true });
  openSwitcher();
  const field = await screen.findByRole("combobox", { name: "Go to" });
  fireEvent.input(field, { target: { value: "Show cargo test" } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("101"));
  openSwitcher();
  const next = await screen.findByRole("combobox", { name: "Go to" });
  fireEvent.input(next, { target: { value: "Close tail -f build.log" } });
  fireEvent.keyDown(next, { key: "Enter", code: "Enter" });
  await answerQuestion(true);
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "terminal.close").map(call => call.params)).toEqual([{ id: "102" }]));
});

it("u4453c_hints_are_reachable_in_command_menu_and_armed_key_chips", async () => {
  await mountNavigation();
  openSwitcher();
  expect(await screen.findByRole("option", { name: /New Terminal/ })).toHaveTextContent("⌘T");
  fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
  expect(await screen.findByRole("status", { name: "Command leader" })).toContainElement(document.querySelector(".key-chip"));
});
