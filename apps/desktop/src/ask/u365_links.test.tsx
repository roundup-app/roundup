import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import * as Solid from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectedProjectContext } from "../state/connectedProject";
import { TargetText } from "../terminal/TargetText";
import { agent, door } from "../testing/nodes";
import { watchNativeOpen } from "../app/nativeOpen";
import { ask, mountAskBar, openAsk } from "./askFixture";
import { AskBar } from "./AskBar";
import { mountTodos } from "../todos/testHarness";

afterEach(cleanup);

it("u365_ask_row_links_open_once", async () => {
  const text = "open src/a.ts:42 and https://example.com.";

  const { app, connected } = await mountAskBar([ask("links", 1, [{ text, state: "typed", placement: { kind: "routed", workstream: "lead" } }])], null,
    [door("lead", "idle", "ready", { worktree: { path: "/work/lead", branch: "b", base: "main" } })]);

  await openAsk();

  const selected = connected.rail.selected();
  const link = await screen.findByRole("link", { name: "src/a.ts:42" });
  expect(link.closest("button, [role=button]") === null).toBe(true);
  fireEvent.click(link);
  await waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: "/work/lead/src/a.ts", line: 42 }]));
  fireEvent.click(screen.getByRole("link", { name: "https://example.com" }));
  await waitFor(() => expect(app.openedTargets).toHaveLength(2));
  expect(connected.rail.selected()).toBe(selected);
  expect(app.calls.filter(call => ["ask.send", "ask.pick", "message.send", "agent.spawn", "terminal.write"].includes(call.method))).toEqual([]);
});

it.each(["no-worktree", "no-destination"])("u365_ask_row_relative_paths_use_the_destination_%s", async kind => {
  const part = kind === "no-worktree"
    ? { text: "src/a.ts:42", state: "queued" as const, placement: { kind: "routed" as const, workstream: "lead" } }
    : { text: "src/a.ts:42", state: "waiting" as const, placement: { kind: "unclear" as const, question: "Choose work", candidates: [] } };

  const { app } = await mountAskBar([ask("links", 1, [part])], null, [door("lead", "idle", "ready")], false, "/fallback");
  await openAsk();
  const draft = screen.getByRole("textbox", { name: "Ask" });
  fireEvent.input(draft, { target: { value: "exact unsent draft" } });
  fireEvent.click(await screen.findByRole("link", { name: "src/a.ts:42" }));
  await waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: "/fallback/src/a.ts", line: 42 }]));
  expect(draft).toHaveProperty("value", "exact unsent draft");
  expect(app.calls.filter(call => ["ask.send", "ask.pick", "message.send", "agent.spawn", "terminal.write"].includes(call.method))).toEqual([]);
});

it("u365_ask_slash_commands_stay_plain_text", async () => {
  const text = "/clear /context /hope:compose /word /word:word";
  const entry = ask("commands", 1, [{ text, state: "typed", placement: { kind: "routed", workstream: "lead" } }]);
  const { app, connected } = await mountAskBar([entry]);
  await openAsk();
  const draft = screen.getByRole("textbox", { name: "Ask" });
  fireEvent.input(draft, { target: { value: "exact unsent draft" } });
  const calls = app.calls.length;

  const readonly = render(() => <ConnectedProjectContext.Provider value={connected}>
    <TargetText text={text} base="/" />
  </ConnectedProjectContext.Provider>);

  expect(readonly.container.querySelectorAll("a")).toHaveLength(0);
  const row = await screen.findByRole("button", { name: /\/clear/ });
  expect(row.querySelectorAll("a")).toHaveLength(0);
  fireEvent.mouseOver(row);
  expect(app.attemptedTargets).toEqual([]);
  expect(app.calls.slice(calls).filter(call => ["agent.spawn", "rail.startDoor", "agent.prompt", "ask.send", "ask.pick", "message.send", "terminal.write"].includes(call.method))).toEqual([]);
  fireEvent.click(row);
  await waitFor(() => expect(connected.rail.selected()).toBe("lead"));
  expect(connected.asks.entries()[0]?.parts[0]?.placement).toEqual(entry.parts[0]!.placement);
  expect(draft).toHaveProperty("value", "exact unsent draft");
  expect(app.attemptedTargets).toEqual([]);
});

/** The App's one route for a `roundup://` link, on a mounted Project. */
const routeLinks = (app: Awaited<ReturnType<typeof mountAskBar>>["app"], connected: Awaited<ReturnType<typeof mountAskBar>>["connected"], ann: ReturnType<typeof agent>) => {
  app.add(connected.project.path);
  app.handlers["link.read"] = () => ({ kind: "agent", id: "ann", node: ann, digest: null });
  // SAFETY: a link to an Agent reads only `projects.select`.
  createRoot(() => watchNativeOpen({
    solid: Solid, app, projects: { select: vi.fn() } as never, connectionOf: () => connected,
    item: () => document.createElement("div"), fail: vi.fn(),
  }));
};

const url = "roundup://agent/ann?project=project-0000000000000000";

const reads = (app: Awaited<ReturnType<typeof mountAskBar>>["app"]) => app.calls.filter(call => call.method === "link.read").map(call => call.params);

it("al5_inbox_and_overview_text_links_open_the_object", async () => {
  const ann = agent("ann", "idle", "ready", { name: "Ann" });

  const overview = await mountAskBar(
    [ask("links", 1, [{ text: `Open ${url}.`, state: "typed", placement: { kind: "routed", workstream: "lead" } }])],
    null, [door("lead", "idle", "ready"), ann]);

  await openAsk();

  routeLinks(overview.app, overview.connected, ann);
  fireEvent.click(await screen.findByRole("link", { name: url }));
  await waitFor(() => expect(overview.connected.rail.selected()).toBe("ann"));
  expect(reads(overview.app)).toEqual([{ url }]);
  expect(overview.app.openedTargets).toEqual([]);
  cleanup();

  const inbox = await mountTodos([], true, [ann, agent("asker", "needs-you", `Read ${url} next`, { name: "Asker" })]);
  render(() => <ConnectedProjectContext.Provider value={inbox.connected}><AskBar /></ConnectedProjectContext.Provider>);
  inbox.connected.showView(null);
  inbox.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });
  routeLinks(inbox.app, inbox.connected, ann);
  fireEvent.click(document.querySelector<HTMLElement>('[data-row="a:asker"] .inbox-row')!);
  fireEvent.click(await screen.findByRole("link", { name: url }));
  await waitFor(() => expect(inbox.connected.rail.selected()).toBe("ann"));
  expect(reads(inbox.app)).toEqual([{ url }]);
  expect(inbox.app.openedTargets).toEqual([]);
});
