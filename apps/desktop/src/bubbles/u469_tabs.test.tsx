import { bubbleChord } from "./bubblesFixture";
import { revealBubble } from "./bubblesFixture";
import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { info } from "../testing/nodes";
import { bubbleCalls, mountBubbles } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

afterEach(cleanup);

it("u469_tabs_show_one_bubble_and_toggle_the_shown_one_off", async () => {
  await mountBubbles();
  await waitFor(() => expect(document.querySelectorAll('.bubble')).toHaveLength(2));
  const tab = document.querySelector<HTMLButtonElement>('.bubble[data-bubble="1"]')!;
  revealBubble("1");
  expect(tab.hasAttribute("hidden")).toBe(false);
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  fireEvent.click(document.querySelector('.bubble[data-bubble="1"] button[aria-label="Minimise"]')!);
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(0);
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".pane-screen [tabindex]")));
});

it("u469_tabs_include_shown_and_minimised_terminals_in_start_order", async () => {
  await mountBubbles();
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".bubble")];
  expect(tabs.map(tab => tab.getAttribute("aria-label"))).toEqual(["cargo test", "zsh"]);
  expect(tabs.map(tab => tab.hasAttribute("hidden"))).toEqual([true, false]);
  expect(document.querySelector(".bubble-dock")).toBeNull();
});

it("u469_selection_swaps_workstream_tabs_and_only_the_selected_agents_runs", async () => {
  const { connected } = await mountBubbles();
  connected.rail.select("b");
  expect([...document.querySelectorAll('.bubble')].map(tab => tab.getAttribute("aria-label"))).toEqual(["zsh", "other run"]);
  connected.rail.select("other");
  expect(document.querySelectorAll('.bubble')).toHaveLength(0);
});

it("u469_tab_close_calls_once_without_toggling_or_restoring", async () => {
  const mounted = await mountBubbles();
  let finish!: () => void;
  mounted.app.handlers["terminal.close"] = () => new Promise<null>(resolve => { finish = () => resolve(null); });
  const close = document.querySelector<HTMLButtonElement>('.bubble[aria-label=\"cargo test\"] button[aria-label=\"Close\"]')!;
  fireEvent.click(close);
  fireEvent.click(close);
  await answerQuestion(true);
  await waitFor(() => expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{id: "1"}]));
  expect(document.querySelector<HTMLButtonElement>('.bubble[data-bubble="1"]')!.hasAttribute("hidden")).toBe(true);
  finish();
  await waitFor(() => expect(document.querySelector('[role="alert"]')).toBeNull());
});

it("u469_failed_close_keeps_the_tab_bubble_and_visible_failure", async () => {
  const mounted = await mountBubbles();
  mounted.app.handlers["terminal.close"] = () => { throw new Error("cannot close"); };

  const close = document.querySelector<HTMLButtonElement>('.bubble[aria-label=\"zsh\"] button[aria-label=\"Close\"]')!;
  close.focus();
  fireEvent.click(close);
  await answerQuestion(true);
  await screen.findByRole("alert", { name: "cannot close" });
  expect(document.querySelector('.bubble[data-bubble="2"]')?.hasAttribute("hidden")).toBe(false);
  expect(document.activeElement).toBe(close);
});

it.each(["plus", "chord"])("u524_plus_and_cmd_t_from_the_project_root_open_in_the_first_workstream_%s", async (activation) => {
  const mounted = await mountBubbles(null);

  if (activation === "plus") bubbleChord("t");
  else window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  await waitFor(() => expect(document.querySelector('.bubble[data-bubble="9"]')?.hasAttribute("hidden")).toBe(false));
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([{workstream: "w"}]);
  expect(mounted.connected.rail.selected()).toBeNull();
});

it("u524_every_root_opened_terminal_stays_in_the_bar_after_returning", async () => {
  const projectTerminal = info("project", { owner: "/p", title: "project shell" });
  const mounted = await mountBubbles(null, [projectTerminal]);
  const listed = [projectTerminal];
  let opened = 0;

  mounted.app.handlers["terminal.open"] = ({ workstream: owner }) => {
    const id = `root-${++opened}`;
    listed.push(info(id, { owner, title: `shell ${opened}` }));
    mounted.setListed([...listed]);

    return { terminal_id: id };
  };

  const tabs = () => [...document.querySelectorAll(".bubble")].map(tab => tab.getAttribute("data-bubble")).sort();

  for (const id of ["root-1", "root-2", "root-3"]) {
    bubbleChord("t");
    // Wait for the acknowledged Terminal focus, then join the Rail refresh before another open.
    await waitFor(() => expect(document.activeElement?.closest(".bubble")?.getAttribute("data-bubble")).toBe(id));
    await mounted.connected.rail.refresh({ terminals: true });
  }

  expect(tabs()).toEqual(["project", "root-1", "root-2", "root-3"].sort());
  mounted.connected.rail.select("w");
  expect(tabs()).toEqual(["root-1", "root-2", "root-3"]);
  mounted.connected.rail.select(null);
  expect(tabs()).toEqual(["project", "root-1", "root-2", "root-3"].sort());
});

it("u524_a_project_terminal_is_available_after_reload", async () => {
  const mounted = await mountBubbles(null, [info("9", { owner: "/p", title: "login" })], []);
  await waitFor(() => expect(document.querySelector('.bubble[data-bubble="9"]')).not.toBeNull());
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([]);
  fireEvent.click(document.querySelector('.bubble[data-bubble="9"] button[aria-label="Close"]')!);
  await answerQuestion(true);
  await waitFor(() => expect(document.querySelector('.bubble[data-bubble="9"]')).toBeNull());
  expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{ id: "9" }]);
});

it.each(["plus", "chord"])("u469_plus_and_cmd_t_share_one_opening_path_and_show_the_new_bubble_%s", async (activation) => {
  const mounted = await mountBubbles();

  if (activation === "plus") bubbleChord("t");
  else window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true }));
  await waitFor(() => expect(document.querySelector('.bubble[data-bubble="9"]')?.hasAttribute("hidden")).toBe(false));
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
  revealBubble("2");
  expect(bubble.getAttribute("style")).toBe(geometry);
});


it("u469_duplicate_names_close_only_the_matching_terminal", async () => {
  const { info } = await import("../testing/nodes");
  const mounted = await mountBubbles("w", [info("1",{owner:"w",title:"zsh"}),info("2",{owner:"w",title:"zsh"})]);

  fireEvent.click(document.querySelector('.bubble[data-bubble="2"] button[aria-label="Close"]')!);
  await answerQuestion(true);
  await waitFor(() => expect(document.querySelectorAll('.bubble')).toHaveLength(1));
  expect(bubbleCalls(mounted.app,"terminal.close")).toEqual([{id:"2"}]);
  expect(document.querySelector('.bubble')?.getAttribute("data-bubble")).toBe("1");
});

it("u469_exit_updates_the_tab_and_keeps_the_last_screen", async () => {
  const { event } = await import("../testing/nodes");
  const mounted = await mountBubbles();
  const body = document.querySelector('.bubble[data-bubble="2"] .bubble-body');

  mounted.app.emit(event({name:"terminal.exited",data:{id:"2",code:3}}));
  await waitFor(() => expect(mounted.connected.rail.terminalExit("2")).toEqual({ kind: "code", code: 3 }));
  expect(document.querySelector('.bubble[data-bubble="2"] .bubble-body')).toBe(body);
  expect(document.querySelectorAll('.bubble')).toHaveLength(2);
});

it("u469_a_new_run_keeps_selection_focus_and_the_existing_shown_bubble", async () => {
  const { event, info } = await import("../testing/nodes");
  const { TERMINALS } = await import("./bubblesFixture");
  const mounted = await mountBubbles();
  const tab = document.querySelector<HTMLElement>('.bubble[data-bubble="2"] .bubble-header')!;

  tab.focus();
  mounted.setListed([...TERMINALS, info("4",{owner:"a",title:"new Run"})]);
  mounted.app.emit(event({name:"terminal.changed"}));
  await waitFor(() => expect(document.querySelectorAll('.bubble')).toHaveLength(3));
  expect(document.querySelector('.bubble[data-bubble="4"]')?.hasAttribute("hidden")).toBe(true);
  expect(document.activeElement).toBe(tab);
  expect(mounted.connected.rail.selected()).toBe("a");
});

it("u469_open_guards_and_failures_preserve_the_existing_bubble", async () => {
  const mounted = await mountBubbles();

  mounted.app.handlers["terminal.open"] = () => { throw new Error("no shell"); };

  bubbleChord("t");
  await screen.findByRole("alert", { name: "no shell" });
  expect(document.querySelector('.bubble[data-bubble="2"]')?.hasAttribute("hidden")).toBe(false);
});

it("u469_the_agents_own_pane_and_ownerless_terminals_are_not_tabs", async () => {
  const { info } = await import("../testing/nodes");

  await mountBubbles("a", [info("t-a", {owner:"a"}), info("4", {owner:null}), info("5",{owner:"a",title:"Run"})]);
  expect([...document.querySelectorAll('.bubble')].map(e=>e.getAttribute("aria-label"))).toEqual(["Run"]);
});




it("u469_a_late_open_keeps_the_new_workstreams_shown_bubble", async () => {
  const { info } = await import("../testing/nodes");
  const initial = [info("2", {owner:"w"}), info("10", {owner:"other",title:"other shell"})];
  const mounted = await mountBubbles("w", initial);
  let finish!: () => void;

  mounted.app.handlers["terminal.open"] = () => new Promise(resolve => {
    finish = () => { mounted.setListed([...initial,info("9",{owner:"w"})]); resolve({terminal_id:"9"}); };
  });
  bubbleChord("t");
  mounted.connected.rail.select("other");
  finish();
  await waitFor(() => expect(mounted.app.calls.filter(call => call.method === "terminal.list").length).toBeGreaterThan(1));
  expect(document.querySelector('.bubble[data-bubble="10"]')?.hasAttribute("hidden")).toBe(false);
});

it("u469_daemon_exit_keeps_one_read_only_bubble_and_clears_saved_places", async () => {
  const mounted = await mountBubbles();

  mounted.setExit({code:1});
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  expect(window.sessionStorage.getItem('roundup:bubble-places:/p')).toBeNull();
});

it("u3512a_terminal_close_waits_for_one_native_answer_and_cancel_keeps_it", async () => {
  const { app } = await mountBubbles();
  const close = document.querySelector<HTMLButtonElement>('.bubble[aria-label=\"cargo test\"] button[aria-label=\"Close\"]')!;
  fireEvent.click(close);
  fireEvent.click(close);
  expect(app.questions).toHaveLength(1);
  expect(await questionDialog()).toEqual({ title: "Close cargo test?", message: "The Terminal and its output will be removed. Its running program will stop.", okLabel: "Close", cancelLabel: "Keep" });
  expect(bubbleCalls(app, "terminal.close")).toEqual([]);
  await answerQuestion(false);
  expect(bubbleCalls(app, "terminal.close")).toEqual([]);
  expect(close.isConnected).toBe(true);
  fireEvent.click(close);
  await answerQuestion(true);
  await waitFor(() => expect(bubbleCalls(app, "terminal.close")).toEqual([{ id: "1" }]));
});

it("u3512a_terminal_alert_failure_keeps_the_terminal_for_retry", async () => {
  const { app } = await mountBubbles();
  app.questionFailure = new Error("Native alert unavailable; try closing again");
  const close = document.querySelector<HTMLButtonElement>('.bubble[aria-label=\"cargo test\"] button[aria-label=\"Close\"]')!;
  fireEvent.click(close);
  await screen.findByRole("alert", { name: "Native alert unavailable" });
  expect(bubbleCalls(app, "terminal.close")).toEqual([]);
  expect(close.isConnected).toBe(true);
  app.questionFailure = null;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await answerQuestion(true);
  await waitFor(() => expect(bubbleCalls(app, "terminal.close")).toEqual([{ id: "1" }]));
});
