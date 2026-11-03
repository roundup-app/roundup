import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { saveAppSettings } from "../settings/preferences";
import { agent, door } from "../testing/nodes";
import { App } from "../App";
import { createProjectDrafts } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import type { ActionReply, ActionRequest, ProjectCalls } from "./seam";
import { RpcError } from "./seam";

const SOURCE = { name: "Renamed source Project", path: "/repos/source" };

const TARGET = "/repos/target";

const request = (id: number, path = TARGET, source = SOURCE.path): ActionRequest => ({ id, method: "project.open", params: { path, source, agent: { id: "1", name: "builder" } } });

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

  return { app, opening, drafts, answer: (value: ActionRequest) => answer!(value), invalidate: () => invalidate?.() };
};

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await saveAppSettings({ permissionMode: "" }); localStorage.clear(); });

it("u5765_open_waits_for_bound_consent_and_uses_the_existing_open_flow_once", async () => {
  const mounted = await mount();
  let settled = false;

  const reply = mounted.answer(request(11)).then(value => {
    settled = true;

    return value;
  });

  const dialog = await screen.findByRole("dialog");
  expect(screen.getByRole("dialog", { description: new RegExp(["builder", SOURCE.name, TARGET].join(".*")) })).toBe(dialog);
  expect(settled).toBe(false);
  expect(mounted.opening).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await reply).toEqual({ jsonrpc: "2.0", id: 11, result: { path: TARGET } });
  expect(mounted.opening).toHaveBeenCalledExactlyOnceWith(TARGET);
  expect(mounted.app.calls.filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);
});

it("u5765_queued_requests_cannot_share_consent", async () => {
  const mounted = await mount();
  const first = mounted.answer(request(21));
  const second = mounted.answer(request(22, "/repos/second"));
  await screen.findByRole("dialog");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
  expect(await first).toMatchObject({ id: 21, error: { code: -32002 } });
  await screen.findByRole("dialog", { description: /\/repos\/second/ });
  expect(mounted.opening).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await second).toMatchObject({ id: 22, result: { path: "/repos/second" } });
  expect(mounted.opening).toHaveBeenCalledExactlyOnceWith("/repos/second");
});

it("u5765_stale_registration_invalidates_its_confirmation", async () => {
  const mounted = await mount();
  const reply = mounted.answer(request(31));
  await screen.findByRole("dialog");
  const old = screen.getByRole("button", { name: "Open" });
  mounted.invalidate();
  expect(await reply).toMatchObject({ id: 31, error: { code: -32004 } });
  fireEvent.click(old);
  expect(mounted.opening).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([SOURCE.path, "/repos/real-source"])("u5765_open_b_preserves_the_selected_project_without_an_extra_open: %s", async canonicalPath => {
  const mounted = await mount(canonicalPath);
  const holder = mounted.drafts(SOURCE.path);
  const destination = { surface: "terminal_selection", object: "original", recipient: "builder" };
  const draft = holder.edit(destination, { note: " exact é \u{1f469}\u{1f3fd}\u200d\u{1f4bb}\n  unfinished ", excerpt: "source bytes" }, null, "ordinary");
  await draft.retained;
  const before = holder.list();
  const reply: ActionReply = await mounted.answer(request(41, canonicalPath, canonicalPath));
  expect(holder.list()).toEqual(before);
  expect(reply).toMatchObject({ id: 41, result: { path: canonicalPath } });
  expect(mounted.opening).not.toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: SOURCE.name }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("u5765_open_failure_returns_its_cause_and_visible_recovery", async () => {
  const mounted = await mount();
  const holder = mounted.drafts(SOURCE.path);
  await holder.edit({ surface: "terminal_selection", object: "original", recipient: "builder" }, { note: " unsent failure work\n  é ", excerpt: "source bytes" }, null, "ordinary").retained;
  const before = holder.list();
  mounted.app.opened.failure = new RpcError(-32001, "Folder unavailable");
  const reply = mounted.answer(request(51));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const result = await reply;
  expect(result).toMatchObject({ id: 51, error: { code: -32001, message: expect.stringContaining("Folder unavailable") } });

  if (!("error" in result)) throw new Error("opening must report its failure");
  expect(result.error.message).toContain(TARGET);
  expect(result.error.message).toContain("try again");
  expect(holder.list()).toEqual(before);
  expect(await screen.findByRole("dialog", { description: /Folder unavailable/ })).toBeDefined();
});

it("u5765_navigation_preserves_the_asking_project_and_request", async () => {
  const mounted = await mount();
  const reply = mounted.answer(request(71));
  await screen.findByRole("dialog");
  mounted.app.nativeOpen({ kind: "project", path: "/repos/navigation" });
  await screen.findByRole("tab", { name: "navigation" });
  expect(screen.getByRole("dialog", { description: new RegExp(SOURCE.name) })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
  expect(await reply).toMatchObject({ id: 71, error: { code: -32002 } });
  expect(mounted.opening).toHaveBeenCalledExactlyOnceWith("/repos/navigation");
});

it.each(["agent", "workstream", "mode"] as const)("u5765_start_%s_waits_for_consent_then_uses_target_calls", async kind => {
  const mounted = await mount();
  const targetApp = mounted.app.of(TARGET);
  targetApp.handlers["agent.spawn"] = () => agent("made", "idle", "ready");
  targetApp.handlers["rail.createWorkstream"] = () => door("made", "idle", "ready");
  targetApp.handlers["workstream.setOpeningPrompt"] = () => null;
  targetApp.handlers["rail.startDoor"] = () => door("made", "idle", "ready");
  const prompt = " exact first prompt\n  é ";
  const reply = mounted.answer({ id: 61, method: "project.start", params: { path: TARGET, source: SOURCE.path, agent: { id: "1", name: "builder" }, kind, name: "target-worker", prompt } });
  await screen.findByRole("dialog");
  expect(mounted.app.calls.filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const result = await reply;
  expect(result).not.toHaveProperty("error");
  expect(result).toMatchObject({ id: 61, result: { path: TARGET, kind, id: expect.any(String) } });
  const target = mounted.app.of(TARGET);
  const created = target.calls.find(call => call.method === (kind === "agent" ? "agent.spawn" : "rail.createWorkstream"));
  expect(created?.params).toMatchObject({ name: "target-worker", start_attribution: { project: SOURCE.path, project_name: SOURCE.name, agent: "1", agent_name: "builder" } });

  if (kind === "agent") expect(created?.params).toMatchObject({ cwd: TARGET, prompt });
  else {
    const launch = target.calls.find(call => call.method === "rail.startDoor");
    expect(launch?.params).toMatchObject({ prompt });
    const saved = target.calls.findIndex(call => call.method === "workstream.setOpeningPrompt");

    if (kind === "mode") expect(saved).toBeLessThan(target.calls.findIndex(call => call.method === "rail.startDoor"));
    else expect(saved).toBe(-1);
  }
});

it.each(["agent", "workstream", "mode"] as const)("u5765_start_%s_in_open_b_uses_normal_permissions_and_preserves_source_draft", async kind => {
  for (const permissionMode of ["acceptEdits", ""] as const) {
    await saveAppSettings({ permissionMode });
    const mounted = await mount(SOURCE.path, true);
    const target = mounted.app.of(TARGET);
    target.handlers["agent.spawn"] = () => agent("made", "idle", "ready");
    target.handlers["rail.createWorkstream"] = () => door("made", "idle", "ready");
    target.handlers["workstream.setOpeningPrompt"] = () => null;
    target.handlers["rail.startDoor"] = () => door("made", "idle", "ready");
    const holder = mounted.drafts(SOURCE.path);
    await holder.edit({ surface: "terminal_selection", object: "original", recipient: "builder" }, { note: " unsent é\n ", excerpt: "source bytes" }, null, "ordinary").retained;
    const before = holder.list();
    const result = await mounted.answer({ id: 71, method: "project.start", params: { path: TARGET, source: SOURCE.path, agent: { id: "1", name: "builder" }, kind, name: "worker", prompt: "work there" } });
    expect(result).toMatchObject({ id: 71, result: { path: TARGET, kind, id: "made" } });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mounted.opening).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: SOURCE.name }).getAttribute("aria-selected")).toBe("true");
    expect(holder.list()).toEqual(before);
    const launch = target.calls.find(call => call.method === (kind === "agent" ? "agent.spawn" : "rail.startDoor"));
    expect(launch?.params).not.toHaveProperty("mode");

    if (permissionMode) expect(launch?.params).toHaveProperty("permissionMode", permissionMode);
    else expect(launch?.params).not.toHaveProperty("permissionMode");
    cleanup();
  }
});

it.each(["agent", "workstream", "mode"] as const)("u5765_refusing_%s_creates_nothing", async kind => {
  const mounted = await mount();
  const pending = mounted.answer({ id: 81, method: "project.start", params: { path: TARGET, source: SOURCE.path, agent: { id: "1", name: "builder" }, kind, name: "worker", prompt: "work there" } });
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
  expect(await pending).toMatchObject({ id: 81, error: { code: -32002 } });
  expect(mounted.opening).not.toHaveBeenCalled();
  expect(mounted.app.of(TARGET).calls.filter(call => ["agent.spawn", "rail.createWorkstream", "rail.startDoor"].includes(call.method))).toEqual([]);
});

it("u5765_target_failure_reports_the_created_identity_without_retrying", async () => {
  const mounted = await mount(SOURCE.path, true);
  const target = mounted.app.of(TARGET);
  target.handlers["rail.createWorkstream"] = () => door("made", "idle", "ready");
  target.handlers["rail.startDoor"] = () => { throw new RpcError(-32003, "Vendor unavailable"); };

  const result = await mounted.answer({ id: 91, method: "project.start", params: { path: TARGET, source: SOURCE.path, agent: { id: "1", name: "builder" }, kind: "workstream", name: "target-worker", prompt: "work there" } });
  expect(result).toMatchObject({ id: 91, error: { code: -32003 } });

  if (!("error" in result)) throw new Error("a failed launch must not succeed");
  expect(result.error.message).toContain(TARGET);
  expect(result.error.message).toContain("made");
  expect(result.error.message).toContain("start failed");
  expect(target.calls.filter(call => call.method === "rail.createWorkstream")).toHaveLength(1);
  expect(target.calls.filter(call => call.method === "rail.startDoor")).toHaveLength(1);
  expect(await screen.findByRole("dialog", { description: /target-worker.*Vendor unavailable/ })).toBeDefined();
});
