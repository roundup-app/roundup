import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { createProjectDrafts } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import type { ActionReply, ActionRequest, ProjectCalls } from "./seam";
import { RpcError } from "./seam";

const SOURCE = { name: "Renamed source Project", path: "/repos/source" };

const TARGET = "/repos/target";

const request = (id: number, path = TARGET): ActionRequest => ({ id, method: "project.open", params: { path, source: SOURCE.path, agent: { id: "1", name: "builder" } } });

const mount = async () => {
  const app = createFakeApp();
  app.opened.project = SOURCE;
  let answer: Parameters<NonNullable<ProjectCalls["serveActions"]>>[0] | undefined;
  let invalidate: (() => void) | undefined;
  app.serveActions = async (handler, invalidated) => { answer = handler; invalidate = invalidated; };

  const opening = vi.spyOn(app, "openProject");
  const drafts = createProjectDrafts();
  render(() => <App drafts={drafts} app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByRole("tab", { name: SOURCE.name });
  await waitFor(() => expect(answer).toBeDefined());

  return { app, opening, drafts, answer: (value: ActionRequest) => answer!(value), invalidate: () => invalidate?.() };
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

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

it("u5765_open_b_preserves_the_selected_project_without_an_extra_open", async () => {
  const mounted = await mount();
  const holder = mounted.drafts(SOURCE.path);
  const destination = { surface: "terminal_selection", object: "original", recipient: "builder" };
  const draft = holder.edit(destination, { note: " exact é 👩🏽‍💻\n  unfinished ", excerpt: "source bytes" }, null, "ordinary");
  await draft.retained;
  const before = holder.list();
  const reply: ActionReply = await mounted.answer(request(41, SOURCE.path));
  expect(holder.list()).toEqual(before);
  expect(reply).toMatchObject({ id: 41, result: { path: SOURCE.path } });
  expect(mounted.opening).not.toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: SOURCE.name }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("u5765_open_failure_returns_its_cause_and_visible_recovery", async () => {
  const mounted = await mount();
  mounted.app.opened.failure = new RpcError(-32001, "Folder unavailable");
  const reply = mounted.answer(request(51));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await reply).toMatchObject({ id: 51, error: { code: -32001, message: "Folder unavailable" } });
  expect(await screen.findByText(/Folder unavailable/)).toBeDefined();
});

it("u5765_escape_refuses_and_restores_the_original_focus", async () => {
  const mounted = await mount();
  const original = screen.getByRole("tab", { name: SOURCE.name });
  original.focus();
  const reply = mounted.answer(request(61));
  await screen.findByRole("dialog");
  fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  expect(await reply).toMatchObject({ id: 61, error: { code: -32002 } });
  await waitFor(() => expect(document.activeElement).toBe(original));
  expect(mounted.opening).not.toHaveBeenCalled();
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
