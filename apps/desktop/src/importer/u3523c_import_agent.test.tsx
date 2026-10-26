import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectFakeProject } from "../terminal/paneHarness";
import { ConnectedProjectContext } from "../state/connectedProject";
import { ImportPanel } from "./ImportPanel";
import { connectProject } from "../state/connectedProject";
import { agent } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u3523c_explicit_prompt_starts_one_import_agent", async () => {
  const { app, connected } = await connectFakeProject([]);
  let finish!: () => void;
  app.handlers["agent.spawn"] = () => new Promise(resolve => { finish = () => resolve(agent("importer", "working", "starting")); });
  render(() => <ConnectedProjectContext.Provider value={connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  const field = screen.getByRole("textbox", { name: "Import instructions" });
  fireEvent.input(field, { target: { value: "  List yesterday’s work\nwithout importing.  " } });
  expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Start import Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "Start import Agent" }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "agent.spawn")?.params).toMatchObject({ cwd: connected.project.path, prompt: "  List yesterday’s work\nwithout importing.  " });
  finish();
  await waitFor(() => expect(connected.importing.listingAgent()).toBe("importer"));
  expect(app.calls.filter(call => call.method === "project.importCommit")).toHaveLength(0);
});

it("u3523d_listed_candidates_require_user_confirm", async () => {
  const { app, connected } = await connectFakeProject([]);
  app.handlers["agent.spawn"] = () => agent("importer", "working", "starting");
  app.handlers["project.importDiscover"] = () => ({ candidates: [{ source: "candidate", title: "Listed work", cwd: "", revision: "preview", last_activity_ms: 1n }], excluded: [] });
  app.handlers["project.importCommit"] = () => ({ outcomes: [] });
  render(() => <ConnectedProjectContext.Provider value={connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Start import Agent" }));
  await waitFor(() => expect(connected.importing.listingAgent()).toBe("importer"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /Listed work/ }));
  expect(app.calls.filter(call => call.method === "project.importCommit")).toHaveLength(0);
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(app.calls.find(call => call.method === "project.importCommit")?.params).toEqual({ agent: "importer", selections: [{ source: "candidate", revision: "preview" }] }));
});

it("u3523c_import_draft_keeps_project_and_revisions", async () => {
  const { app, connected } = await connectFakeProject([]);
  app.handlers["agent.spawn"] = () => { throw new Error("Launch unavailable. Retry."); };

  const mount = () => render(() => <ConnectedProjectContext.Provider value={connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  const first = mount();
  fireEvent.input(screen.getByRole("textbox", { name: "Import instructions" }), { target: { value: "  exact\nunfinished 🪁  " } });
  fireEvent.click(screen.getByRole("button", { name: "Start import Agent" }));
  await screen.findByText("Launch unavailable. Retry.");
  await connected.importing.setPrompt("  exact\nunfinished 🪁  ");
  first.unmount();
  const reopened = await connectProject(app, connected.project, () => false, () => 0, () => null);
  render(() => <ConnectedProjectContext.Provider value={reopened}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  const restored = screen.getByRole("textbox", { name: "Import instructions" });

  expect(restored instanceof HTMLTextAreaElement && restored.value).toBe("  exact\nunfinished 🪁  ");
  expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1);
});
