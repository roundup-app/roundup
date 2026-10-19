import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
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


it("u2773a_orders_restores_exact_work", async () => {
  const holder = draftStorage(FIRST.path);
  const exact = "  Order e\u0301 🪁\nlast line  ";
  holder.edit({ surface: "orders", object: "removed-agent", recipient: "removed-agent" }, { ask: exact, title: "Same name", done: "" }, { start: 2, end: 5, direction: "forward" }, "ordinary");
  await started();
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  expect(await screen.findByRole("region", { name: "Unfinished work" })).toBeTruthy();
  expect(screen.getByText(exact, { exact: true, normalizer: (text) => text })).toBeTruthy();
  expect(screen.getByRole("button", { name: /orders · removed-agent/ })).toBeTruthy();
  window.localStorage.clear();
});

it("u2773e_recovery_actions_keep_surface_draft_with_invalid_stored_bytes", async () => {
  const bytes = '{"version":999,"drafts":broken';
  window.localStorage.setItem(`roundup:drafts:${FIRST.path}`, bytes);
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const saved = holder.edit({ surface: "orders", object: "original", recipient: "original" }, { ask: "  memory 🧭\n" }, null, "ordinary").draft;
  const app = createFakeApp();
  app.opened.project = FIRST;
  render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(FIRST.path);
  expect(alert.textContent).toContain("orders");
  const clipboard = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  fireEvent.click(screen.getByRole("button", { name: "Copy ask" }));
  expect(clipboard).toHaveBeenCalledWith("  memory 🧭\n");
  fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
  expect(holder.list()).toEqual([saved]);
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  expect(holder.list()).toEqual([]);
  expect(window.localStorage.getItem(`roundup:drafts:${FIRST.path}`)).toBe(bytes);
  expect(app.calls.filter(({ method }) => method === "agent.setOrder" || method === "message.send")).toEqual([]);
  window.localStorage.clear();
});
