import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { saveAppSettings } from "../settings/preferences";
import { door, mode } from "../testing/nodes";
import { App } from "../App";
import { createProjectDrafts } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import type { ProjectCalls } from "../app/seam";
import { RpcError } from "../app/seam";

const SOURCE = { name: "Source", path: "/repos/source" };

const TARGET = "/repos/target";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await saveAppSettings({ permissionMode: "" }); localStorage.clear(); });

it.each([
  ["mode", "agent.restartMode", new Error("timeout"), true],
  ["workstream", "rail.startDoor", new Error("timeout"), true],
  ["mode", "agent.restartMode", new RpcError(-32003, "Vendor unavailable"), false],
  ["workstream", "rail.startDoor", new RpcError(-32003, "Vendor unavailable"), false],
] as const)("u7498b_unknown_start_outcome_reads_as_unknown (%s, %s, unknown=%s)", async (kind, method, thrown, unknown) => {
  const app = createFakeApp();
  app.opened.project = SOURCE;
  app.add(TARGET);
  let answer: Parameters<NonNullable<ProjectCalls["serveActions"]>>[0] | undefined;
  app.serveActions = async handler => { answer = handler; };

  render(() => <App drafts={createProjectDrafts()} app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByRole("tab", { name: SOURCE.name });
  await vi.waitFor(() => expect(answer).toBeDefined());
  const target = app.of(TARGET);
  target.handlers["rail.createWorkstream"] = () => door("made", "idle", "ready");
  target.handlers["agent.createMode"] = ({ name, prompt }) => mode("made", prompt, { name });
  target.handlers[method] = () => { throw thrown; };

  const result = await answer?.({ id: 5, method: "project.start", params: { path: TARGET, source: SOURCE.path, agent: { id: "1", name: "builder" }, kind, name: "target-worker", prompt: "go" } });

  if (!result || !("error" in result)) throw new Error("a thrown launch must not succeed");
  const dialog = await screen.findByRole("dialog");
  const text = dialog.textContent ?? "";
  expect(target.calls.filter(call => call.method === method)).toHaveLength(1);

  if (unknown) {
    expect(result.error.code).toBe(-32004);
    expect(result.error.message).toMatch(/unknown/);
    expect(result.error.message).toContain(TARGET);
    expect(result.error.message).toContain("made");
    expect(result.error.message).not.toMatch(/failed|try again/);
    expect(text).toMatch(/unknown/);
    expect(text).not.toMatch(/failed|try again/i);
  } else {
    expect(result.error.code).toBe(-32003);
    expect(text).toMatch(/failed/i);
  }
});
