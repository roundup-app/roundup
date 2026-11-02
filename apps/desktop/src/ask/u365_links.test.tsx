import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { door } from "../testing/nodes";
import { ask, mountAskBar } from "./askFixture";

afterEach(cleanup);

it("u365_ask_row_links_open_once", async () => {
  const text = "open src/a.ts:42 and https://example.com.";

  const { app, connected } = await mountAskBar([ask("links", 1, [{ text, state: "typed", placement: { kind: "routed", workstream: "lead" } }])], null,
    [door("lead", "idle", "ready", { worktree: { path: "/work/lead", branch: "b", base: "main" } })]);

  const selected = connected.rail.selected();
  fireEvent.click(await screen.findByRole("link", { name: "src/a.ts:42" }));
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
});
