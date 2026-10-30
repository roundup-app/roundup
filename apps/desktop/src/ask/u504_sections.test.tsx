import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { useBrowserStorage } from "../state/storage";
import { AskBar } from "./AskBar";
import { ask } from "./askFixture";
import type { Reaction } from "@contracts/reaction/Reaction";
import type { Deliverable } from "@contracts/deliverable/Deliverable";

const sent = ask("same-id", 1000, [{ text: "same text", placement: { kind: "routed", workstream: "target" }, state: "typed" }]);

const reaction: Reaction = { project: "p", id: "reaction", name: "same name", actor: { kind: "user", id: "you", parent: null }, home: null, target: "target", instruction: "inspect", reason: null, condition: { kind: "agents", ids: ["target"], any: false }, max_firings: 1, remaining: 1, rearm: false, expires_at: "2030-01-01T00:00:00Z", created_at: "1970-01-01T00:00:02Z", state: "active", observation: { health: "observing", health_code: "observing", cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: null, gap: null, recovery: null, evidence: null }, firings: [] };

const made: Deliverable = { project: "p", id: "made", maker: { kind: "user", id: "you", parent: null }, maker_name: "Me", home: null, title: "same name", published_at: 3000, target: { kind: "external", url: "https://example.com/result", availability: "not-checked" } };

const headings = () => [...document.querySelectorAll<HTMLButtonElement>(".overview-sections [data-part=item-trigger]")];

const expanded = () => headings().map(button => button.getAttribute("aria-expanded") === "true");

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = async (path: string, attention = false, times = [1000, 2000, 3000], empty = false) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => attention ? [agent("waiting", "needs-you", "permission")] : [];
  app.handlers["ask.list"] = () => empty ? [] : [{ ...sent, at: BigInt(times[0]!) }];
  app.handlers["reaction.list"] = () => empty ? [] : [{ ...reaction, created_at: new Date(times[1]!).toISOString() }];
  app.handlers["deliverable.list"] = () => empty ? [] : [{ ...made, published_at: times[2]! }];
  const connected = await connectProject(app, { name: "p", path }, () => true, () => 0);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  await connected.rail.settled();
  await waitFor(() => expect(connected.asks.loadState()).toBe("ready"));
  await waitFor(() => expect(headings()).toHaveLength(4));

  return { app, connected };
};

it.each([
  { attention: true, times: [1000, 2000, 3000], winner: 0 },
  { attention: false, times: [4000, 2000, 3000], winner: 1 },
  { attention: false, times: [1000, 4000, 3000], winner: 2 },
  { attention: false, times: [1000, 2000, 3000], winner: 3 },
  { attention: false, times: [3000, 3000, 3000], winner: 1 },
])("u504_initial_section_prefers_attention_then_newest_unseen: $winner $times", async ({ attention, times, winner }) => {
  await mount(`/initial-${crypto.randomUUID()}`, attention, times);
  await waitFor(() => expect(expanded()).toEqual([0, 1, 2, 3].map(index => index === winner)));
});

it("u504_arrows_move_between_section_headings", async () => {
  const { app } = await mount(`/keys-${crypto.randomUUID()}`, false, [], true);
  const buttons = headings();
  buttons[0]!.focus();
  await waitFor(() => expect(buttons[0]!.hasAttribute("data-focus")).toBe(true));

  for (const index of [0, 1, 2, 3, 3]) {
    await waitFor(() => expect(document.activeElement).toBe(buttons[index]));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  }

  for (const index of [3, 2, 1, 0, 0]) {
    await waitFor(() => expect(document.activeElement).toBe(buttons[index]));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  }

  expect(expanded()).toEqual([false, false, false, false]);
  expect(app.calls.filter(call => ["ask.send", "agent.start", "reaction.run", "terminal.write"].includes(call.method))).toEqual([]);
});

it("u504_unseen_tracks_visible_items_and_persists_per_project", async () => {
  const observers: { callback: IntersectionObserverCallback; targets: Element[] }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    current: { callback: IntersectionObserverCallback; targets: Element[] };
    constructor(callback: IntersectionObserverCallback) { this.current = { callback, targets: [] }; observers.push(this.current); }
    observe(target: Element) { this.current.targets.push(target); }
    disconnect() { this.current.targets = []; }
  });
  localStorage.clear();
  useBrowserStorage(localStorage);
  const path = `/seen-${crypto.randomUUID()}`;
  const { connected } = await mount(path);
  await waitFor(() => expect(expanded()[3]).toBe(true));
  expect(headings()[3]!.querySelector(".overview-unseen")).not.toBeNull();

  const visible = (id: string, isIntersecting: boolean) => {
    const observer = observers.findLast(observer => observer.targets.some(target => target.getAttribute("data-overview-item") === id))!;
    const target = observer.targets.find(target => target.getAttribute("data-overview-item") === id)!;
    // SAFETY: the visibility boundary reads only target and isIntersecting; the observer argument is unused.
    observer.callback([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  };

  await waitFor(() => expect(observers.some(observer => observer.targets.some(target => target.getAttribute("data-overview-item") === "made"))).toBe(true));
  visible("made", false);
  expect(headings()[3]!.querySelector(".overview-unseen")).not.toBeNull();
  visible("made", true);
  await waitFor(() => expect(headings()[3]!.querySelector(".overview-unseen")).toBeNull());
  headings()[1]!.focus();
  await waitFor(() => expect(headings()[1]!.hasAttribute("data-focus")).toBe(true));
  fireEvent.click(headings()[1]!);
  await waitFor(() => expect(expanded()).toEqual([false, true, false, false]));
  await waitFor(() => expect(document.querySelector('[data-overview-item="same-id:0"]')).not.toBeNull());
  visible("same-id:0", true);
  expect(connected.asks.acknowledged(connected.asks.entries()[0]!, 0)).toBe(false);
  await waitFor(() => expect(headings()[1]!.querySelector(".overview-unseen")).toBeNull());
  cleanup();
  await mount(path);
  await waitFor(() => expect(expanded()[2]).toBe(true));
  expect(headings()[1]!.querySelector(".overview-unseen")).toBeNull();
  cleanup();
  await mount(`${path}-other`);
  await waitFor(() => expect(expanded()[3]).toBe(true));
  expect(headings()[1]!.querySelector(".overview-unseen")).not.toBeNull();
});

it("u4276b_requests_use_ask_without_manual_creation", async () => {
  const { app, connected } = await mount(`/request-${crypto.randomUUID()}`, false, [], true);
  connected.showView("reactions");
  await waitFor(() => expect(expanded()).toEqual([false, false, true, false]));
  expect(document.querySelector(".reaction-form")).toBeNull();
  const field = document.querySelector<HTMLTextAreaElement>(".ask-input")!;
  const text = "Ask me when the build finishes\n exact words";
  app.handlers["ask.send"] = () => ({ ...sent, text });
  fireEvent.input(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "ask.send").map(call => call.params)).toMatchObject([{ text }]));
  expect(app.calls.filter(call => call.method === "reaction.create")).toEqual([]);
  await waitFor(() => expect(expanded()).toEqual([false, true, false, false]));
});
