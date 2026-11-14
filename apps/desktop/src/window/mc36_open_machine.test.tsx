import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { saveAppSettings } from "../settings/preferences";
import { agent, door, mode } from "../testing/nodes";
import { App } from "../App";
import { createProjectDrafts } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import type { ActionReply, ActionRequest, ProjectCalls } from "../app/seam";
import { RpcError } from "../app/seam";

const SOURCE = { name: "Renamed source Project", path: "/repos/source" };

const TARGET = "/repos/target";

const request = (id: number, machine?: string): ActionRequest => ({ id, method: "project.open", params: { path: TARGET, machine, source: SOURCE.path, agent: { id: "1", name: "builder" } } });

const mount = async (canonicalPath = SOURCE.path, targetOpen = false) => {
  const app = createFakeApp();
  app.opened.project = SOURCE;

  if (targetOpen) app.add(TARGET);
  app.canonicalProjectPath = async () => canonicalPath;
  let answer: Parameters<NonNullable<ProjectCalls["serveActions"]>>[0] | undefined;
  let invalidate: (() => void) | undefined;
  app.serveActions = async (handler, invalidated) => { answer = handler; invalidate = invalidated; };

  const opening = vi.spyOn(app, "openProject");
  const drafts = createProjectDrafts();
  render(() => <App drafts={drafts} app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByRole("tab", { name: SOURCE.name });
  await waitFor(() => expect(answer).toBeDefined());

  if (targetOpen) fireEvent.click(screen.getByRole("tab", { name: SOURCE.name }));

  return { app, opening, drafts, answer: async (value: ActionRequest) => { if (!answer) throw new Error("no relay registered");

 return answer(value); }, invalidate: () => invalidate?.() };
};

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await saveAppSettings({ permissionMode: "" }); localStorage.clear(); });

it("mc36_open_with_machine_sets_the_projects_machine", async () => {
  const mounted = await mount(SOURCE.path, true);
  const target = mounted.app.of(TARGET);
  target.handlers["project.setMachine"] = () => null;
  const reply = await mounted.answer(request(1, "roundup-ci-control"));
  expect(reply).toEqual({ jsonrpc: "2.0", id: 1, result: { path: TARGET } });
  expect(target.calls.filter(call => call.method === "project.setMachine")).toEqual([{ method: "project.setMachine", params: { machine: "roundup-ci-control" } }]);
});

it("mc36_open_without_machine_sets_none", async () => {
  const mounted = await mount(SOURCE.path, true);
  const target = mounted.app.of(TARGET);
  target.handlers["project.setMachine"] = () => null;
  expect(await mounted.answer(request(2))).toMatchObject({ result: { path: TARGET } });
  expect(target.calls.filter(call => call.method === "project.setMachine")).toEqual([]);
});

it("mc36_set_machine_failure_fails_the_open", async () => {
  const mounted = await mount(SOURCE.path, true);
  mounted.app.of(TARGET).handlers["project.setMachine"] = () => { throw new RpcError(-32001, "no such Machine"); };

  const reply = await mounted.answer(request(3, "roundup-ci-control"));
  expect(reply).toMatchObject({ id: 3, error: { code: -32001 } });
});
