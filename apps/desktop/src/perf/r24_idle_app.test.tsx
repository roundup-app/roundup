import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { createTauriApp } from "../app/tauri";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { createFakeApp } from "../testing/fakeApp";
import { agent, event, info } from "../testing/nodes";
import { fakeEmulators, subscribed } from "../terminal/paneHarness";
import { createIdleRun } from "./idle_run";

afterEach(() => { cleanup(); clearMocks(); vi.unstubAllEnvs(); Reflect.deleteProperty(window, "__roundupIdleEvidence"); });

it("r24_the_app_keeps_its_selected_terminal_from_ten_agents_to_one_without_spawning_or_typing", async () => {
  const app = createFakeApp();
  const { factory, made } = fakeEmulators();
  let nodes = Array.from({ length: 10 }, (_, index) => agent(`idle-${index}`, "idle", "idle"));

  app.opened.project = { name: "isolated", path: "/r24" };
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => nodes.map(node => info(node.terminal_id!));
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });

  vi.stubEnv("VITE_ROUNDUP_IDLE_PERF", "1");
  const records: { command: string; payload: InvokeArgs | undefined }[] = [];

  mockIPC((command, payload) => { records.push({ command, payload });

 return null; });

  const idle = createIdleRun(createTauriApp().recordIdleEvidence, () => 0);

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={factory} prepareIdle={idle.prepare} observeTerminal={idle.selected} />);
  await subscribed(app, "t-idle-0");
  expect(made.get("t-idle-0")?.host).toBeTruthy();

  nodes = nodes.slice(0, 1);
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(document.querySelectorAll('[role="treeitem"]').length).toBe(1));

  await idle.flush();
  expect(records.at(-1)).toMatchObject({ command: "record_idle_evidence", payload: { record: { project: "/r24", terminal: "t-idle-0" } } });
  expect(app.calls.filter(call => call.method === "agent.spawn" || call.method === "terminal.write")).toEqual([]);
  idle.stop();
});

it("r24_a_missing_native_command_rejects_the_measurement_delivery", async () => {
  vi.stubEnv("VITE_ROUNDUP_IDLE_PERF", "1");
  mockIPC(() => { throw "native producer unavailable"; });

  const idle = createIdleRun(createTauriApp().recordIdleEvidence, () => 0);

  await expect(idle.flush()).rejects.toThrow("native producer unavailable");
  idle.stop();
});
