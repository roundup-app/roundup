import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { key, mount } from "../testing/navigationFixture";
import { questionProbe, openProjectPage } from "../testing/menuProbe";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

import { info, event, workstream } from "../testing/nodes";

it.each(["keyboard", "native-menu", "rail"].flatMap(source => ["home", "a1", null, "empty"].map(selection => ({ source, selection }))))("u4274c_new_terminal_opens_once_and_focuses: $source $selection", async ({ source, selection }) => {
  const { connected, daemon, shells } = await mount(selection === "empty");
  const owner = selection === "empty" ? null : "home";
  connected().rail.select(selection === "empty" ? null : selection);

  daemon.handlers["terminal.open"] = () => { shells.push(info("opened", { owner: owner ?? "/p" }));

    return { terminal_id: "opened" }; };

  if (source === "keyboard") key("KeyT", { metaKey: true });
  else if (source === "native-menu") openProjectPage("action:chord:⌘T", "/p");
  else fireEvent.click(document.querySelector<HTMLButtonElement>('.rail-actions [aria-label="New Terminal"]')!);
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("opened"));
  expect(daemon.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: owner }]);
  expect(document.querySelector('.bubble:not([hidden])[data-bubble="opened"]')).not.toBeNull();
  expect(daemon.calls.filter(call => ["agent.spawn", "rail.createWorkstream", "rail.startDoor"].includes(call.method))).toHaveLength(0);
});

it("u4274c_terminal_bar_follows_eligible_terminals", async () => {
  const { daemon, connected, shells, nodes, emulators } = await mount(true);
  const portal = document.querySelector(".resource-agent");
  expect(document.querySelector('.terminal-tabs')).toBeNull();

  daemon.handlers["terminal.open"] = () => { shells.push(info("opened", { owner: "/p" }));

    return { terminal_id: "opened" }; };

  key("KeyT", { metaKey: true });
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("opened"));
  const emulator = emulators.made.get("opened");
  const tab = document.querySelector<HTMLButtonElement>('.terminal-tab[data-bubble="opened"]')!;
  fireEvent.click(tab);
  expect(tab.getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelector(".terminal-tabs")?.getAttribute("role")).toBe("group");
  shells[0] = info("opened", { owner: "/p", running: false, exit_code: 0 });
  daemon.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(connected().rail.terminals()[0]?.running).toBe(false));
  expect(document.querySelector('.terminal-tab[data-bubble="opened"]')).not.toBeNull();
  fireEvent.click(tab);
  expect(tab.getAttribute("aria-pressed")).toBe("true");
  nodes.push(workstream("other"));
  await connected().rail.refresh({ terminals: true });
  connected().rail.select("other");
  expect(document.querySelector(".terminal-tabs")?.getAttribute("role")).toBe("group");
  expect(document.querySelectorAll(".terminal-tab")).toHaveLength(0);
  connected().rail.select(null);
  daemon.handlers["terminal.close"] = () => { shells.length = 0;

    return null; };

  fireEvent.click(document.querySelector<HTMLButtonElement>('.terminal-tab-pair[data-bubble="opened"] button:last-child')!);
  await waitFor(() => expect(questionProbe.answer).not.toBeNull());
  questionProbe.answer!(true);
  await waitFor(() => expect(connected().rail.terminals()).toHaveLength(0));
  expect(document.querySelector('.terminal-tabs')).toBeNull();
  expect(document.querySelector(".resource-agent")).toBe(portal);
  expect(emulators.made.get("opened")).toBe(emulator);
  expect(emulator?.disposed).toBe(false);
  expect(daemon.calls.filter(call => call.method === "terminal.close").map(call => call.params)).toEqual([{ id: "opened" }]);
});
