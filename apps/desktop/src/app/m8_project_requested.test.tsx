import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Requested } from "@contracts/project/Requested";
import { createProjectDrafts } from "../state/connectedProject";
import { draftStorage } from "../state/storage";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";
import { RpcError } from "./seam";

const FIRST = { name: "payments-api", path: "/Users/me/repos/payments-api" };

const SECOND = "/Users/me/repos/ledger";

const request = (app: FakeApp, data: Requested) => {
  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "project.requested", data });
};

const started = async () => {
  const app = createFakeApp();

  app.opened.project = FIRST;

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);
  await screen.findByRole("tab", { name: FIRST.name });
  await screen.findAllByText(/^(new )?Workstream$/);

  return app;
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("m8 an Agent opens and renames Projects", () => {
  it("m8_the_webview_answers_a_requested_open_with_open_project", async () => {
    const app = await started();

    request(app, { kind: "open", path: SECOND });

    await screen.findByRole("tab", { name: "ledger" });
  });

  it("m8_a_failed_open_shows_the_error_line", async () => {
    const app = await started();

    app.opened.failure = new RpcError(-32000, "not a folder");
    request(app, { kind: "open", path: SECOND });

    await screen.findByText(/not a folder/);
  });

  it("m8_a_requested_rename_calls_rename_project", async () => {
    const app = await started();

    request(app, { kind: "rename", path: FIRST.path, name: "billing" });

    await screen.findByRole("tab", { name: "billing" });
  });
});


it("u2773h_current_revision_is_distinct", async () => {
  const holder = draftStorage(FIRST.path);
  const exact = "  Order e\u0301 🪁\nlast line  ";
  const saved = holder.edit({ surface: "orders", object: "removed-agent", recipient: "removed-agent" }, { ask: exact, title: "Same name", done: "" }, { start: 2, end: 5, direction: "forward" }, "ordinary").draft;
  // Two independently retained unsubmitted revisions may arrive from external recovery.
  window.localStorage.setItem(`roundup:drafts:${FIRST.path}`, JSON.stringify({ version: 1, drafts: [
    { ...saved, revision: "older-revision", value: { ask: "older" } }, saved,
  ] }));
  await started();
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });
  const revisions = within(recovery).getAllByRole("listitem");
  expect(revisions.filter((row) => row.dataset.current === "true").map((row) => row.dataset.revision)).toEqual([saved.revision]);
  expect(screen.getByText(exact, { exact: true, normalizer: (text) => text })).toBeTruthy();
  expect(screen.getByRole("button", { name: new RegExp(saved.revision) })).toBeTruthy();
  window.localStorage.clear();
});

it("u2773h_invalid_storage_preserves_recoverable_work", async () => {
  const bytes = '{"version":999,"drafts":broken';
  window.localStorage.setItem(`roundup:drafts:${FIRST.path}`, bytes);
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const other = holder.edit({ surface: "todos", object: "other-original", recipient: null }, { title: "  independent 🧭\n" }, null, "ordinary").draft;
  const saved = holder.edit({ surface: "orders", object: "original", recipient: "original" }, { ask: "  memory 🧭\n" }, null, "ordinary").draft;
  const app = createFakeApp();
  app.opened.project = FIRST;
  render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(FIRST.path);
  expect(alert.textContent).toContain("Order");
  const clipboard = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  fireEvent.click(screen.getByRole("button", { name: "Copy ask" }));
  expect(clipboard).toHaveBeenCalledWith("  memory 🧭\n");
  fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
  expect(holder.list()).toEqual([other, saved]);
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  expect(holder.list()).toEqual([other]);
  expect(window.localStorage.getItem(`roundup:drafts:${FIRST.path}`)).toBe(bytes);
  expect(app.calls.filter(({ method }) => method === "agent.setOrder" || method === "message.send")).toEqual([]);
  window.localStorage.clear();
});


it("u2773h_credential_values_remain_hidden_until_copy", async () => {
  const drafts = createProjectDrafts();
  const secret = "sentinel-credential-recovery";
  drafts(FIRST.path).edit({ surface: "decisions", object: "original-prompt", recipient: "original-agent" }, { password: secret }, null, "credential");
  const app = createFakeApp();
  app.opened.project = FIRST;
  render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  await screen.findByRole("region", { name: "Unfinished work" });
  expect(document.body.innerHTML).not.toContain(secret);
  const clipboard = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
  expect(clipboard).toHaveBeenCalledWith(secret);
});

it.each(["loading", "failed", "creation"])("u2773c_pads_external_change_keeps_original_%s_unverified", async (state) => {
  const drafts = createProjectDrafts();
  drafts(FIRST.path).edit({ surface: "pads", object: state === "creation" ? "new-pad" : "original-incarnation", recipient: null }, state === "creation" ? { name: "proposed name", source: "new work" } : { originalName: "original name", source: "exact work", base: "original base" }, null, "ordinary");
  const app = createFakeApp();
  app.opened.project = FIRST;

  if (state === "loading") app.handlers["pad.list"] = () => new Promise(() => {});

  if (state === "failed") app.handlers["pad.list"] = async () => { throw new Error("list unavailable"); };

  render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });
  expect(within(recovery).getByRole("status").dataset.state).toBe("unverified");
  expect(within(recovery).getByText(state === "creation" ? "new work" : "exact work")).toBeTruthy();
  expect(app.calls.filter(({ method }) => method.startsWith("pad.") && method !== "pad.list")).toEqual([]);
});
