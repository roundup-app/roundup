import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage } from "../testing/menuProbe";
import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { info } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each(["keyboard", "menu", "rail"].flatMap(source => ["home", "a1", null, "empty"].map(selection => ({ source, selection }))))("u4274c_new_terminal_opens_once_and_focuses: $source $selection", async ({ source, selection }) => {
  const { daemon, connected, shells, emulators } = await mountNavigation(selection === "empty");

  if (selection !== "empty") connected().rail.select(selection);

  const owner = selection === "empty" ? null : "home";
  daemon.handlers["terminal.open"] = () => { shells.push(info("shell", { owner: owner ?? "/p" }));

    return { terminal_id: "shell" }; };

  if (source === "keyboard") window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  else if (source === "menu") openProjectPage("action:chord:⌘T", "/p");
  else fireEvent.click(within(screen.getByRole("region", { name: "Rail" })).getByRole("button", { name: "New Terminal" }));
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: owner }]);
  expect(daemon.calls.filter(call => ["rail.createWorkstream", "rail.startDoor", "agent.spawn"].includes(call.method))).toHaveLength(0);
  expect(emulators.made.has("shell")).toBe(true);
  expect(document.querySelector('.bubble[data-bubble="shell"]')).not.toBeNull();
  expect(document.querySelector('.terminal-tabs[role="group"]')).toBeTruthy();
});

it("u4274c_terminal_bar_follows_eligible_terminals", async () => {
  const { connected, daemon, shells, emulators } = await mountNavigation(true);
  const portal = document.querySelector(".resource-agent");
  expect(document.querySelector('.terminal-tabs[role="group"]')).toBeNull();
  shells.push(info("shell", { owner: "/p" }));
  await connected().rail.refresh({ terminals: true });
  const bar = await screen.findByRole("group", { name: "Terminals" });
  fireEvent.click(document.querySelector('.terminal-tab[data-bubble="shell"]')!);
  await waitFor(() => expect(emulators.made.has("shell")).toBe(true));
  fireEvent.click(document.querySelector('.terminal-tab[data-bubble="shell"]')!);
  expect(document.querySelector('.terminal-tabs[role="group"]')).toBe(bar);
  shells[0] = info("shell", { owner: "/p", running: false, exit_code: 0 });
  await connected().rail.refresh({ terminals: true });
  expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).not.toBeNull();
  shells.splice(0);
  await connected().rail.refresh({ terminals: true });
  expect(document.querySelector('.terminal-tabs[role="group"]')).toBeNull();
  expect(document.querySelector(".resource-agent")).toBe(portal);
  expect(daemon.calls.filter(call => ["terminal.close", "terminal.write"].includes(call.method))).toHaveLength(0);
});

it("u4274c_terminal_bar_follows_eligible_terminals_on_selection", async () => {
  const { connected, daemon, nodes, shells } = await mountNavigation();
  shells.push(info("shell", { owner: "home" }));
  nodes.push({ ...nodes[0]!, id: "other", name: "Other", order: 20 });
  await connected().rail.refresh({ terminals: true });
  connected().rail.select("a1");
  await waitFor(() => expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).not.toBeNull());
  const bar = document.querySelector(".terminal-tabs");
  connected().rail.select("other");
  expect(document.querySelectorAll(".terminal-tab")).toHaveLength(0);
  expect(document.querySelector(".terminal-tabs")).toBe(bar);
  connected().rail.select("a1");
  expect(document.querySelector('.terminal-tab[data-bubble="shell"]')).not.toBeNull();
  expect(daemon.calls.filter(call => call.method === "terminal.close")).toHaveLength(0);
});

it("u524_a_failed_empty_project_open_can_be_retried", async () => {
  const { daemon, shells } = await mountNavigation(true);
  daemon.handlers["terminal.open"] = () => { throw new Error("cannot open"); };

  const action = document.querySelector<HTMLButtonElement>(".rail-terminal-new")!;
  fireEvent.click(action);
  await screen.findByRole("alert");
  await waitFor(() => expect(document.activeElement).toBe(action));
  daemon.handlers["terminal.open"] = () => {
    shells.push(info("shell", { owner: "/p" }));

    return { terminal_id: "shell" };
  };

  fireEvent.click(action);
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: null }, { workstream: null }]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u4274c_closing_the_last_terminal_returns_focus_to_rail", async () => {
  const { connected, daemon, shells } = await mountNavigation(true);
  shells.push(info("shell", { owner: "/p" }));
  await connected().rail.refresh({ terminals: true });
  daemon.handlers["terminal.close"] = () => { shells.splice(0);

    return null; };

  const close = document.querySelector<HTMLButtonElement>('.terminal-tab-pair[data-bubble="shell"] button:last-child')!;
  close.focus();
  fireEvent.click(close);
  await answerQuestion(true);
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".rail-terminal-new")));
  expect(document.querySelector(".terminal-tabs")).toBeNull();
  expect(daemon.calls.filter(call => call.method === "terminal.close").map(call => call.params)).toEqual([{ id: "shell" }]);
});

it.each(["empty", "hidden", "shown"])("u4277c_terminal_empty_feedback_uses_project_inventory_%s", async inventory => {
  const { connected, shells } = await mountNavigation(true);

  if (inventory !== "empty") {
    shells.push(info("shell", { owner: inventory === "hidden" ? "other" : "/p" }));
    await connected().rail.refresh({ terminals: true });
  }

  if (inventory === "empty") expect(screen.queryByRole("group", { name: "Terminals" })).toBeNull();
  else {
    const bar = await screen.findByRole("group", { name: "Terminals" });
    expect(within(bar).queryByRole("status")).toBeNull();
  }
});
