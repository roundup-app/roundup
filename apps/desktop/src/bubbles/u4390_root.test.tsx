import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { event, info } from "../testing/nodes";
import { bubbleCalls, bubbleChord, mountBubbles } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(cleanup);

const tabs = () => [...document.querySelectorAll(".terminal-tab")].map(tab => tab.getAttribute("data-bubble"));

const openThroughStaleList = async (activation: string) => {
  const project = info("project", { owner: "/p", title: "project shell" });
  const opened = info("9", { owner: "w", title: "new shell" });
  const mounted = await mountBubbles(null, [project]);
  const acknowledgement = Promise.withResolvers<{ terminal_id: string }>();
  const stale = Promise.withResolvers<TerminalInfo[]>();
  const firstListing = Promise.withResolvers<TerminalInfo[]>();
  const requested = Promise.withResolvers<void>();
  const openingRequested = Promise.withResolvers<void>();
  let lists = 0;
  mounted.app.handlers["terminal.open"] = () => acknowledgement.promise;
  mounted.app.handlers["terminal.list"] = () => {
    if (++lists === 1) { requested.resolve(); return stale.promise; }
    openingRequested.resolve();
    return firstListing.promise;
  };

  if (activation === "plus") fireEvent.click(document.querySelector('[aria-label="New Terminal"]')!);
  else bubbleChord("t");
  mounted.app.emit(event({ name: "terminal.changed" }));
  await requested.promise;
  acknowledgement.resolve({ terminal_id: "9" });
  // The opening queues its refresh synchronously after consuming the acknowledgement.
  await acknowledgement.promise;
  const openingDone = mounted.connected.rail.settled();
  stale.resolve([project]);
  await openingRequested.promise;
  expect(mounted.connected.rail.terminals().map(terminal => terminal.id)).toEqual(["project"]);
  mounted.setListed([project, opened]);
  mounted.app.handlers["terminal.list"] = () => [project, opened];
  firstListing.resolve([project, opened]);
  await openingDone;
  await mounted.connected.rail.settled();
  await waitFor(() => expect(document.activeElement?.closest(".bubble")?.getAttribute("data-bubble")).toBe("9"));
  return mounted;
};

it.each(["plus", "chord"])("u4390_root_open_survives_a_stale_list_before_first_listing_%s", async activation => {
  const mounted = await openThroughStaleList(activation);
  expect(tabs()).toEqual(["project", "9"]);
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([{ workstream: "w" }]);
  expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([]);
  expect(mounted.connected.rail.terminals().find(terminal => terminal.id === "9")?.owner).toBe("w");
  expect(mounted.connected.rail.selected()).toBeNull();
  mounted.connected.rail.select("w");
  expect(tabs()).toEqual(["9"]);
  mounted.connected.rail.select(null);
  expect(tabs()).toEqual(["project", "9"]);
});

it("u4390_close_after_first_listing_removes_only_the_chosen_terminal", async () => {
  const mounted = await openThroughStaleList("plus");
  mounted.app.handlers["terminal.list"] = () => mounted.connected.rail.terminals().filter(terminal => terminal.id !== "9");
  fireEvent.click(document.querySelector('[aria-label="Close new shell"]')!);
  await answerQuestion(true);
  await waitFor(() => expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{ id: "9" }]));
  await mounted.connected.rail.settled();
  expect(tabs()).toEqual(["project"]);
  expect(document.querySelector('.bubble[data-bubble="9"]')).toBeNull();
  mounted.connected.rail.select("w");
  mounted.connected.rail.select(null);
  expect(tabs()).toEqual(["project"]);
});
