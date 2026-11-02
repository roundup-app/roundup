import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectFakeProject } from "../terminal/paneHarness";
import { ConnectedProjectContext } from "../state/connectedProject";
import { ImportPanel } from "./ImportPanel";
import { connectProject } from "../state/connectedProject";
import { agent, event } from "../testing/nodes";

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
  // start() releases the controls after its draft persistence acknowledges the launch.
  await waitFor(() => expect(connected.importing.starting()).toBe(false));
  app.emit({ ...event({ name: "rail.changed" }), actor: { kind: "agent", id: "importer", parent: null } });
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


it("u5558d_listing_signal_updates_candidates", async () => {
  const { app, connected } = await connectFakeProject([]);
  app.handlers["agent.spawn"] = () => agent("importer", "working", "starting");
  app.handlers["project.importDiscover"] = () => ({ candidates: [], excluded: [] });
  render(() => <ConnectedProjectContext.Provider value={connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  await connected.importing.start();
  const before = app.calls.filter(call => call.method === "project.importDiscover").length;
  app.handlers["project.importDiscover"] = () => ({ candidates: [{ source: "new-listing", revision: "new-revision", title: "Saved candidate", cwd: "", last_activity_ms: 1n }], excluded: [] });
  app.emit({ ...event({ name: "rail.changed" }), actor: { kind: "agent", id: "other", parent: null } });
  expect(app.calls.filter(call => call.method === "project.importDiscover")).toHaveLength(before);
  app.emit({ ...event({ name: "rail.changed" }), actor: { kind: "agent", id: "importer", parent: null } });
  expect(await screen.findByRole("checkbox", { name: /Saved candidate/ })).toHaveProperty("checked", false);
  expect(app.calls.filter(call => call.method === "project.importDiscover").slice(before)).toEqual([{ method: "project.importDiscover", params: { agent: "importer", period: connected.importing.period() } }]);
  expect(app.calls.filter(call => call.method === "project.importCommit")).toHaveLength(0);
  expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1);
});

it("u5558d_new_listing_revalidates_existing_choices", async () => {
  const { app, connected } = await connectFakeProject([]);
  app.handlers["agent.spawn"] = () => agent("importer", "working", "starting");
  let revision = "original";
  app.handlers["project.importDiscover"] = () => ({ candidates: [{ source: "chosen", revision, title: "Chosen work", cwd: "", last_activity_ms: 1n }], excluded: [] });
  render(() => <ConnectedProjectContext.Provider value={connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  await connected.importing.start();
  await connected.importing.setPrompt("  retain exact 🐝\n  ");
  app.emit({ ...event({ name: "rail.changed" }), actor: { kind: "agent", id: "importer", parent: null } });
  fireEvent.click(await screen.findByRole("checkbox", { name: /Chosen work/ }));
  await waitFor(() => expect(connected.importing.selected().size).toBe(1));
  revision = "changed";
  app.emit({ ...event({ name: "rail.changed" }), actor: { kind: "agent", id: "importer", parent: null } });
  await waitFor(() => expect(connected.importing.discovery()?.candidates[0]?.revision).toBe("changed"));
  expect(connected.importing.selected().size).toBe(0);
  expect(connected.importing.prompt()).toBe("  retain exact 🐝\n  ");
  expect(app.calls.filter(call => call.method === "project.importCommit")).toHaveLength(0);
  expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1);
});

it("u5558e_failed_reload_retains_data", async () => {
  const { app, connected } = await connectFakeProject([]);
  app.handlers["agent.spawn"] = () => agent("importer", "working", "starting");
  const result = { candidates: [{ source: "kept", revision: "r1", title: "Kept listing", cwd: "", last_activity_ms: 1n }], excluded: [] };
  app.handlers["project.importDiscover"] = () => result;
  render(() => <ConnectedProjectContext.Provider value={connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  await connected.importing.start();
  const signal = () => app.emit({ ...event({ name: "rail.changed" }), actor: { kind: "agent", id: "importer", parent: null } });
  signal();
  await screen.findByRole("checkbox", { name: /Kept listing/ });
  app.handlers["project.importDiscover"] = () => { throw new Error("Saved listing read refused"); };

  signal();
  await screen.findByRole("alert", { name: "Saved listing read refused" });
  expect(screen.getByRole("checkbox", { name: /Kept listing/ })).toBeTruthy();
  app.handlers["project.importDiscover"] = () => result;
  signal();
  await waitFor(() => expect(connected.importing.loading()).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
});
