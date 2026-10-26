import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectFakeProject } from "../terminal/paneHarness";
import { ConnectedProjectContext } from "../state/connectedProject";
import { ImportPanel } from "./ImportPanel";
import { agent } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u3523c_explicit_prompt_starts_one_import_agent", async () => {
  const { app, connected } = await connectFakeProject([]);
  let finish!: () => void;
  app.handlers["agent.spawn"] = () => new Promise(resolve => { finish = () => resolve(agent("importer")); });
  render(() => <ConnectedProjectContext.Provider value={connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  const field = screen.getByRole("textbox", { name: "Import instructions" });
  fireEvent.input(field, { target: { value: "  List yesterday’s work\nwithout importing.  " } });
  expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Start import Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "Start import Agent" }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "agent.spawn")?.params).toMatchObject({ cwd: connected.project.path, prompt: "  List yesterday’s work\nwithout importing.  " });
  finish();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start import Agent" }).hasAttribute("disabled")).toBe(false));
  expect(app.calls.filter(call => call.method === "project.importCommit")).toHaveLength(0);
});
