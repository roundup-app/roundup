import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { bubbleCalls, mountBubbles, TREE } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

afterEach(cleanup);

it("u469_tabs_show_one_bubble_and_toggle_the_shown_one_off", async () => {
  await mountBubbles();
  await waitFor(() => expect(document.querySelectorAll('.terminal-tab')).toHaveLength(2));
  const tab = document.querySelector<HTMLButtonElement>('.terminal-tab[data-bubble="1"]')!;
  fireEvent.click(tab);
  expect(tab.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  fireEvent.click(tab);
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(0);
  await waitFor(() => expect(document.activeElement).toBe(tab));
});

it("u469_tabs_include_shown_and_minimised_terminals_in_start_order", async () => {
  await mountBubbles();
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".terminal-tab")];
  expect(tabs.map(tab => tab.getAttribute("aria-label"))).toEqual(["cargo test", "zsh"]);
  expect(tabs.map(tab => tab.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  expect(document.querySelector(".bubble-dock")).toBeNull();
});

it("u469_selection_swaps_workstream_tabs_and_only_the_selected_agents_runs", async () => {
  const { connected } = await mountBubbles();
  connected.rail.select("b");
  expect([...document.querySelectorAll('.terminal-tab')].map(tab => tab.getAttribute("aria-label"))).toEqual(["zsh", "other run"]);
  connected.rail.select("other");
  expect(document.querySelectorAll('.terminal-tab')).toHaveLength(0);
});

it("u469_tab_close_calls_once_without_toggling_or_restoring", async () => {
  const mounted = await mountBubbles();
  let finish!: () => void;
  mounted.app.handlers["terminal.close"] = () => new Promise<null>(resolve => { finish = () => resolve(null); });
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close cargo test"]')!;
  fireEvent.click(close);
  fireEvent.click(close);
  expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{id: "1"}]);
  expect(document.querySelector<HTMLButtonElement>('.terminal-tab[data-bubble="1"]')!.getAttribute("aria-pressed")).toBe("false");
  finish();
  await waitFor(() => expect(document.querySelector('[role="alert"]')).toBeNull());
});

it("u469_failed_close_keeps_the_tab_bubble_and_visible_failure", async () => {
  const mounted = await mountBubbles();
  mounted.app.handlers["terminal.close"] = () => { throw new Error("cannot close"); };

  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close zsh"]')!;
  close.focus();
  fireEvent.click(close);
  await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("cannot close"));
  expect(document.querySelector('.terminal-tab[data-bubble="2"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(close);
});

it("u469_close_returns_focus_to_a_remaining_control", async () => {
  const mounted = await mountBubbles();
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close cargo test"]')!;
  close.focus();
  fireEvent.click(close);
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.terminal-tab[data-bubble="2"]')));
  expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{id: "1"}]);
});

it.each(["plus", "chord"])("u524_plus_and_cmd_t_from_the_project_root_open_in_the_first_workstream_%s", async (activation) => {
  const mounted = await mountBubbles(null);

  if (activation === "plus") fireEvent.click(document.querySelector('[aria-label="New Terminal"]')!);
  else window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  await waitFor(() => expect(document.querySelector('.terminal-tab[data-bubble="9"]')?.getAttribute("aria-pressed")).toBe("true"));
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([{workstream: "w"}]);
  expect(mounted.connected.rail.selected()).toBeNull();
});

it.each(["plus", "chord"])("u524_an_empty_project_shows_the_message_in_the_bar_and_focuses_the_rail_%s", async (activation) => {
  const mounted = await mountBubbles(null, [], []);
  const add = document.createElement("div");
  add.className = "rail-actions";
  add.innerHTML = '<button data-button="add"></button>';
  document.body.append(add);

  if (activation === "plus") fireEvent.click(document.querySelector('[aria-label="New Terminal"]')!);
  else window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  const note = document.querySelector('.terminal-note');
  expect(note?.getAttribute("role")).toBe("status");
  expect(note?.textContent).toBe("Select a Workstream first");
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([]);
  expect(document.activeElement).toBe(add.firstElementChild);
  add.remove();
});

it("u524_the_message_clears_on_open_selection_or_creation", async () => {
  const note = () => document.querySelector('.terminal-note');
  const plus = () => fireEvent.click(document.querySelector('[aria-label="New Terminal"]')!);
  const mounted = await mountBubbles(null, [], [agent("solo", "working", "busy")]);

  plus();
  expect(note()?.textContent).toBe("Select a Workstream first");
  mounted.connected.rail.select("solo");
  await waitFor(() => expect(note()).toBeNull());

  mounted.connected.rail.select(null);
  plus();
  expect(note()?.textContent).toBe("Select a Workstream first");
  mounted.app.handlers["rail.tree"] = () => TREE;
  await mounted.connected.rail.refresh();
  await waitFor(() => expect(note()).toBeNull());

  mounted.connected.rail.select(null);
  plus();
  await waitFor(() => expect(document.querySelector('.terminal-tab[data-bubble="9"]')).not.toBeNull());
  await waitFor(() => expect(document.activeElement?.closest(".bubble")?.getAttribute("data-bubble")).toBe("9"));
  expect(note()).toBeNull();

  cleanup();
  const failing = await mountBubbles(null);

  failing.app.handlers["terminal.open"] = () => { throw new Error("cannot open"); };

  plus();
  await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("cannot open"));
  expect(note()).toBeNull();
});

it.each(["plus", "chord"])("u469_plus_and_cmd_t_share_one_opening_path_and_show_the_new_bubble_%s", async (activation) => {
  const mounted = await mountBubbles();

  if (activation === "plus") fireEvent.click(document.querySelector('[aria-label="New Terminal"]')!);
  else window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  await waitFor(() => expect(document.querySelector('.terminal-tab[data-bubble="9"]')?.getAttribute("aria-pressed")).toBe("true"));
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([{workstream: "w"}]);
  await waitFor(() => expect(document.activeElement?.closest(".bubble")?.getAttribute("data-bubble")).toBe("9"));
});

it("u469_selection_and_reload_restore_at_most_one_bubble", async () => {
  window.sessionStorage.setItem("roundup:bubble-places:/p", JSON.stringify({
    "1":{x:20,y:20,w:400,h:200,min:false}, "2":{x:40,y:40,w:400,h:200,min:false},
  }));
  const mounted = await mountBubbles();
  expect([...document.querySelectorAll('.bubble:not([hidden])')].map(e => e.getAttribute("data-bubble"))).toEqual(["2"]);
  mounted.connected.rail.select("other");
  mounted.connected.rail.select("a");
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(0);
  cleanup();
  await mountBubbles();
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(0);
});

it("u469_minimise_keeps_the_terminal_running_and_its_saved_geometry", async () => {
  const mounted = await mountBubbles();
  const bubble = document.querySelector<HTMLElement>('.bubble[data-bubble="2"]')!;
  const geometry = bubble.getAttribute("style");

  fireEvent.click(bubble.querySelector('[aria-label="Minimise"]')!);
  expect(bubble.hidden).toBe(true);
  expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([]);
  fireEvent.click(document.querySelector('.terminal-tab[data-bubble="2"]')!);
  expect(bubble.getAttribute("style")).toBe(geometry);
});

it("u469_cmd_b_cycles_one_bubble_then_the_pane_in_both_directions", async () => {
  const { bubbleChord } = await import("./bubblesFixture");

  await mountBubbles();

  for (const [shiftKey, expected] of [[false,"1"],[false,"2"],[false,null],[true,"2"],[true,"1"]] as const) {
    bubbleChord("b", {shiftKey});
    expect([...document.querySelectorAll('.bubble:not([hidden])')].map(e => e.getAttribute("data-bubble"))).toEqual(expected === null ? [] : [expected]);
  }
});

it("u469_bubble_chords_work_from_tabs_without_reaching_the_terminal", async () => {
  const { bubbleChord } = await import("./bubblesFixture");
  const mounted = await mountBubbles();
  const tab = document.querySelector<HTMLButtonElement>('.terminal-tab[data-bubble="1"]')!;

  tab.focus();
  expect(bubbleChord(".", {}, tab).defaultPrevented).toBe(true);
  expect(document.querySelector('.terminal-tab[data-bubble="1"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
});

it("u469_duplicate_names_close_only_the_matching_terminal", async () => {
  const { info } = await import("../testing/nodes");
  const mounted = await mountBubbles("w", [info("1",{owner:"w",title:"zsh"}),info("2",{owner:"w",title:"zsh"})]);

  fireEvent.click(document.querySelector('.terminal-tab-pair[data-bubble="2"] button:last-child')!);
  await waitFor(() => expect(document.querySelectorAll('.terminal-tab')).toHaveLength(1));
  expect(bubbleCalls(mounted.app,"terminal.close")).toEqual([{id:"2"}]);
  expect(document.querySelector('.terminal-tab')?.getAttribute("data-bubble")).toBe("1");
});

it("u469_exit_updates_the_tab_and_keeps_the_last_screen", async () => {
  const { event } = await import("../testing/nodes");
  const mounted = await mountBubbles();
  const body = document.querySelector('.bubble[data-bubble="2"] .bubble-body');

  mounted.app.emit(event({name:"terminal.exited",data:{id:"2",code:3}}));
  await waitFor(() => expect(document.querySelector('.terminal-tab[data-bubble="2"] [aria-label="Exit 3"]')).not.toBeNull());
  expect(document.querySelector('.bubble[data-bubble="2"] .bubble-body')).toBe(body);
  expect(document.querySelectorAll('.terminal-tab')).toHaveLength(2);
});

it("u469_a_new_run_keeps_selection_focus_and_the_existing_shown_bubble", async () => {
  const { event, info } = await import("../testing/nodes");
  const { TERMINALS } = await import("./bubblesFixture");
  const mounted = await mountBubbles();
  const tab = document.querySelector<HTMLButtonElement>('.terminal-tab[data-bubble="2"]')!;

  tab.focus();
  mounted.setListed([...TERMINALS, info("4",{owner:"a",title:"new Run"})]);
  mounted.app.emit(event({name:"terminal.changed"}));
  await waitFor(() => expect(document.querySelectorAll('.terminal-tab')).toHaveLength(3));
  expect(document.querySelector('.terminal-tab[data-bubble="4"]')?.getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(tab);
  expect(mounted.connected.rail.selected()).toBe("a");
});

it("u469_open_guards_and_failures_preserve_the_existing_bubble", async () => {
  const mounted = await mountBubbles();

  mounted.app.handlers["terminal.open"] = () => { throw new Error("no shell"); };

  fireEvent.click(document.querySelector('.terminal-new')!);
  await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("no shell"));
  expect(document.querySelector('.terminal-tab[data-bubble="2"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("u469_the_agents_own_pane_and_ownerless_terminals_are_not_tabs", async () => {
  const { info } = await import("../testing/nodes");

  await mountBubbles("a", [info("t-a", {owner:"a"}), info("4", {owner:null}), info("5",{owner:"a",title:"Run"})]);
  expect([...document.querySelectorAll('.terminal-tab')].map(e=>e.getAttribute("aria-label"))).toEqual(["Run"]);
});

it.each(["previous", "plus"])("u469_close_returns_focus_to_a_remaining_control_%s", async (target) => {
  const { info } = await import("../testing/nodes");

  await mountBubbles("w", target === "plus" ? [info("2",{owner:"w",title:"zsh"})] : [info("1",{owner:"w",title:"first"}),info("2",{owner:"w",title:"zsh"})]);
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close zsh"]')!;

  close.focus();
  fireEvent.click(close);
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(target === "plus" ? '.terminal-new' : '.terminal-tab[data-bubble="1"]')));
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(0);
});

it("u469_close_returns_focus_to_a_remaining_control_from_the_bubble", async () => {
  await mountBubbles();
  const close = document.querySelector<HTMLButtonElement>('.bubble[data-bubble="2"] [aria-label="Close"]')!;

  close.focus();
  fireEvent.click(close);
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.terminal-tab[data-bubble="1"]')));
});

it("u469_close_returns_focus_to_a_run_added_while_close_is_pending", async () => {
  const { event, info } = await import("../testing/nodes");
  const { TERMINALS } = await import("./bubblesFixture");
  const mounted = await mountBubbles();
  const added = info("4", {owner:"a",title:"new Run"});
  let finish!: () => void;

  mounted.app.handlers["terminal.close"] = () => new Promise<null>(resolve => {
    finish = () => { mounted.setListed([...TERMINALS.filter(terminal => terminal.id !== "2"), added]); resolve(null); };
  });
  const control = document.querySelector<HTMLButtonElement>('[aria-label="Close zsh"]')!;

  control.focus();
  fireEvent.click(control);
  mounted.setListed([...TERMINALS, added]);
  mounted.app.emit(event({name:"terminal.changed"}));
  await waitFor(() => expect(document.querySelectorAll('.terminal-tab')).toHaveLength(3));
  finish();
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.terminal-tab[data-bubble="4"]')));
});

it("u469_a_late_open_keeps_the_new_workstreams_shown_bubble", async () => {
  const { info } = await import("../testing/nodes");
  const initial = [info("2", {owner:"w"}), info("10", {owner:"other",title:"other shell"})];
  const mounted = await mountBubbles("w", initial);
  let finish!: () => void;

  mounted.app.handlers["terminal.open"] = () => new Promise(resolve => {
    finish = () => { mounted.setListed([...initial,info("9",{owner:"w"})]); resolve({terminal_id:"9"}); };
  });
  fireEvent.click(document.querySelector('.terminal-new')!);
  mounted.connected.rail.select("other");
  finish();
  await waitFor(() => expect(mounted.app.calls.filter(call => call.method === "terminal.list").length).toBeGreaterThan(1));
  expect(document.querySelector('.terminal-tab[data-bubble="10"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("u469_daemon_exit_keeps_one_read_only_bubble_and_clears_saved_places", async () => {
  const mounted = await mountBubbles();

  mounted.setExit({code:1});
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  expect(window.sessionStorage.getItem('roundup:bubble-places:/p')).toBeNull();
});
