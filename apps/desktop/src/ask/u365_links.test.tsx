import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { ConnectedProjectContext } from "../state/connectedProject";
import { TargetText } from "../terminal/TargetText";
import { RpcError } from "../app/seam";
import { door } from "../testing/nodes";
import { ask, mountAskBar } from "./askFixture";

afterEach(cleanup);

it("u365_ask_row_links_open_once", async () => {
  const text = "open src/a.ts:42 and https://example.com.";

  const { app, connected } = await mountAskBar([ask("links", 1, [{ text, state: "typed", placement: { kind: "routed", workstream: "lead" } }])], null,
    [door("lead", "idle", "ready", { worktree: { path: "/work/lead", branch: "b", base: "main" } })]);

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

it("u365_ask_missing_path_shows_failure", async () => {
  const { app } = await mountAskBar([ask("links", 1, [{ text: "gone.ts", state: "typed", placement: { kind: "routed", workstream: "lead" } }])]);
  app.openFailure = new RpcError(-32001, "not found");
  fireEvent.click(await screen.findByRole("link", { name: "gone.ts" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(app.openedTargets).toEqual([]);
  expect(app.attemptedTargets).toHaveLength(1);
});


it.each(["no-worktree", "no-destination"])("u365_ask_row_relative_paths_use_the_destination_%s", async kind => {
  const part = kind === "no-worktree"
    ? { text: "src/a.ts:42", state: "queued" as const, placement: { kind: "routed" as const, workstream: "lead" } }
    : { text: "src/a.ts:42", state: "waiting" as const, placement: { kind: "unclear" as const, question: "Choose work", candidates: [] } };

  const { app } = await mountAskBar([ask("links", 1, [part])], null, [door("lead", "idle", "ready")], false, "/fallback");
  const draft = screen.getByRole("textbox", { name: "Ask" });
  fireEvent.input(draft, { target: { value: "exact unsent draft" } });
  fireEvent.click(await screen.findByRole("link", { name: "src/a.ts:42" }));
  await waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: "/fallback/src/a.ts", line: 42 }]));
  expect(draft).toHaveProperty("value", "exact unsent draft");
  expect(app.calls.filter(call => ["ask.send", "ask.pick", "message.send", "agent.spawn", "terminal.write"].includes(call.method))).toEqual([]);
});

it("u365_ask_row_links_open_once_in_earlier", async () => {
  const { app, connected } = await mountAskBar([ask("links", 1, [{ text: "/tmp/file.ts https://example.com", state: "typed", placement: { kind: "routed", workstream: "lead" } }])]);
  connected.rail.select("lead");
  await waitFor(() => expect(connected.asks.acknowledged(connected.asks.entries()[0]!, 0)).toBe(true));
  connected.rail.select(null);
  connected.showView("asks");
  fireEvent.click(await screen.findByRole("button", { name: /Earlier/ }));
  fireEvent.click(await screen.findByRole("link", { name: "/tmp/file.ts" }));
  await waitFor(() => expect(app.openedTargets).toHaveLength(1));
  fireEvent.click(screen.getByRole("link", { name: "https://example.com" }));
  await waitFor(() => expect(app.openedTargets).toHaveLength(2));
});


it("u365_ask_slash_commands_stay_plain_text", async () => {
  const text = "/clear /context /hope:compose /word /word:word";
  const entry = ask("commands", 1, [{ text, state: "typed", placement: { kind: "routed", workstream: "lead" } }]);
  const { app, connected } = await mountAskBar([entry]);
  const draft = screen.getByRole("textbox", { name: "Ask" });
  fireEvent.input(draft, { target: { value: "exact unsent draft" } });
  const calls = app.calls.length;

  const readonly = render(() => <ConnectedProjectContext.Provider value={connected}>
    <TargetText text={text} base="/" onFailure={() => { throw new Error("commands must not open"); }} />
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
