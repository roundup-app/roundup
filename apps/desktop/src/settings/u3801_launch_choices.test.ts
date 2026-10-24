import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { saveAppSettings } from "./preferences";

// These cross the same connected App seam that every user launch control calls.
afterEach(() => localStorage.clear());

const connect = async (path = "/p", resume = false) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => resume ? [workstream("door", { can_resume: true, model: "kept-model" })] : [];
  app.handlers["agent.spawn"] = () => agent("new", "working", "starting");
  app.handlers["rail.startDoor"] = () => workstream("door");
  app.handlers["agent.resume"] = () => agent("agent", "working", "starting");
  app.handlers["workstream.clear"] = () => ({ pending: true });
  const connected = await connectProject(app, { name: "p", path }, () => true, Date.now);

  return { app, connected };
};

it("u3801_a_chosen_mode_rides_start_resume_and_clear", async () => {
  const { app, connected } = await connect();
  saveAppSettings({ permissionMode: "plan" });
  await connected.app.rpc("agent.spawn", { cwd: "/p", prompt: null, parent: null });
  await connected.app.rpc("rail.startDoor", { id: "door" });
  await connected.app.rpc("agent.resume", { id: "agent" });
  await connected.app.rpc("workstream.clear", { id: "door", reason: "fresh" });
  expect(app.calls.slice(-4).map(call => call.params)).toEqual([
    { cwd: "/p", prompt: null, parent: null, permissionMode: "plan" }, { id: "door", permissionMode: "plan" },
    { id: "agent", permissionMode: "plan" }, { id: "door", reason: "fresh", permissionMode: "plan" },
  ]);
  connected.stopTerminalScheme();
});

it("u3801_the_default_choice_sends_no_mode", async () => {
  const { app, connected } = await connect();
  saveAppSettings({ permissionMode: "acceptEdits" });
  saveAppSettings({ permissionMode: "" });
  await connected.app.rpc("agent.spawn", { cwd: "/p", prompt: null, parent: null });
  await connected.app.rpc("rail.startDoor", { id: "door" });
  await connected.app.rpc("agent.resume", { id: "agent" });
  await connected.app.rpc("workstream.clear", { id: "door", reason: "fresh" });
  expect(app.calls.slice(-4).map(call => call.params)).toEqual([
    { cwd: "/p", prompt: null, parent: null }, { id: "door" }, { id: "agent" }, { id: "door", reason: "fresh" },
  ]);
  connected.stopTerminalScheme();
});

it("u3801_yolo_ignores_the_choice", async () => {
  const { app, connected } = await connect();
  saveAppSettings({ permissionMode: "plan" });
  await connected.app.rpc("agent.resume", { id: "agent", mode: "yolo" });
  expect(app.calls.at(-1)?.params).toEqual({ id: "agent", mode: "yolo" });
  connected.stopTerminalScheme();
});

it("u3802_engine_and_model_ride_a_new_agent", async () => {
  const { app, connected } = await connect();
  saveAppSettings({ engine: "offered-engine", model: "offered-model" });
  await connected.app.rpc("agent.spawn", { cwd: "/p", prompt: null, parent: null, model: null });
  await connected.app.rpc("rail.startDoor", { id: "door" });
  await connected.app.rpc("agent.spawn", { cwd: "/p", prompt: null, parent: null, model: "one-off" });
  await connected.app.rpc("agent.resume", { id: "agent" });
  expect(app.calls.slice(-4).map(call => call.params)).toEqual([
    { cwd: "/p", prompt: null, parent: null, engine: "offered-engine", model: "offered-model" },
    { id: "door", engine: "offered-engine", model: "offered-model" },
    { cwd: "/p", prompt: null, parent: null, engine: "offered-engine", model: "one-off" }, { id: "agent" },
  ]);
  saveAppSettings({ engine: "", model: "" });
  await connected.app.rpc("rail.startDoor", { id: "door" });
  expect(app.calls.at(-1)?.params).toEqual({ id: "door" });
  connected.stopTerminalScheme();
});

it("u3806_every_open_tab_sees_a_change", async () => {
  const first = await connect();
  const second = await connect("/other-project");
  saveAppSettings({ permissionMode: "auto", model: "chosen" });
  await first.connected.app.rpc("rail.startDoor", { id: "first" });
  await second.connected.app.rpc("rail.startDoor", { id: "second" });
  expect(first.app.calls.at(-1)?.params).toEqual({ id: "first", permissionMode: "auto", model: "chosen" });
  expect(second.app.calls.at(-1)?.params).toEqual({ id: "second", permissionMode: "auto", model: "chosen" });
  first.connected.stopTerminalScheme();
  second.connected.stopTerminalScheme();
});

it("u3802_a_saved_door_resumes_its_model_instead_of_the_new_agent_default", async () => {
  const { app, connected } = await connect("/p", true);
  saveAppSettings({ engine: "new-engine", model: "new-model", permissionMode: "plan" });
  await connected.app.rpc("rail.startDoor", { id: "door" });
  expect(app.calls.at(-1)?.params).toEqual({ id: "door", permissionMode: "plan" });
  connected.stopTerminalScheme();
});
