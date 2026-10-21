import * as v from "valibot";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Requested } from "@contracts/project/Requested";
import { createProjectDrafts } from "../state/connectedProject";
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


const mount = (drafts: ReturnType<typeof createProjectDrafts>) => {
  const app = createFakeApp();

  app.opened.project = FIRST;
  render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} />);

  return app;
};

const failedSave = (holder: ReturnType<ReturnType<typeof createProjectDrafts>>, destination: { surface: string; object: string; recipient: string | null }, value: Record<string, string | boolean | null>) => {
  const { revision } = holder.edit(destination, value, null, "ordinary").draft;

  holder.submit(revision);
  holder.settle(revision, "failed");

  return revision;
};

it("u3021a_recovery_lists_only_work_at_risk", async () => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const destination = { surface: "todos", object: "7", recipient: null };

  holder.edit(destination, { title: "typed and saving" }, null, "ordinary");
  // Picks and unknown availability never qualify.
  failedSave(holder, { surface: "todos", object: "8", recipient: "period" }, { period: "day", done: false });
  mount(drafts);
  await screen.findByRole("tab", { name: FIRST.name });
  expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();

  failedSave(holder, { surface: "todos", object: "9", recipient: null }, { title: "lost when closed" });
  const entry = await screen.findByRole("button", { name: "Recover unfinished work" });

  expect(entry.textContent).toContain("1");
  fireEvent.click(entry);
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });

  expect(within(recovery).getAllByRole("listitem")).toHaveLength(1);
  expect(holder.list()).toHaveLength(3);
});

it.each(["envelope", "surface"])("u3021b_recovery_actions_and_retry_%s", async (kind) => {
  const incompatible = { revision: "incompatible", destination: { surface: "todos", object: "42", recipient: null }, value: { title: false }, selection: null, status: "draft", policy: "ordinary" };
  const bytes = kind === "surface" ? JSON.stringify({ version: 1, drafts: [incompatible] }, null, 2) : '{"version":999,"drafts":broken';
  window.localStorage.setItem(`roundup:drafts:${FIRST.path}`, bytes);
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);

  if (kind === "surface") {
    holder.validate("todos", v.object({ title: v.string() }));
    holder.discard(incompatible.revision);
  }

  const saved = failedSave(holder, { surface: "orders", object: "original", recipient: "original" }, { ask: "  memory 🧭\n" });
  const app = mount(drafts);

  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });
  const alert = await within(recovery).findByRole("alert");

  expect(alert.textContent).not.toContain(FIRST.path);
  expect(within(recovery).queryByRole("button", { name: /Inspect|Copy .+/ })).toBeNull();
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(holder.list().map((draft) => draft.revision)).toEqual([saved]);
  expect(window.localStorage.getItem(`roundup:drafts:${FIRST.path}`)).toBe(bytes);
  fireEvent.click(within(recovery).getByRole("button", { name: "Discard" }));
  expect(holder.list()).toEqual([]);
  expect(app.calls.filter(({ method }) => method === "agent.setOrder" || method === "message.send")).toEqual([]);
  window.localStorage.clear();
});

it("u3021c_copy_and_discard_keep_other_revisions", async () => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const exact = "  Order e\u0301 🪁\nlast line  ";
  const gone = failedSave(holder, { surface: "orders", object: "removed-agent", recipient: "removed-agent" }, { ask: exact, title: "Same name" });
  const other = failedSave(holder, { surface: "todos", object: "9", recipient: null }, { title: "other work" });
  const app = mount(drafts);
  const clipboard = vi.fn(async (_text: string) => {});

  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });
  const row = within(recovery).getAllByRole("listitem").find((item) => item.dataset.revision === gone)!;

  expect(within(row).queryByRole("button", { name: "Open" })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Copy" }));
  expect(clipboard).toHaveBeenCalledTimes(1);
  expect(clipboard).toHaveBeenCalledWith(`${exact}\nSame name`);
  fireEvent.click(within(row).getByRole("button", { name: "Discard" }));
  expect(holder.list().map((draft) => draft.revision)).toEqual([other]);
  expect(app.calls.filter(({ method }) => method === "agent.setOrder" || method === "message.send")).toEqual([]);
});

it("u2773h_credential_values_remain_hidden", async () => {
  const drafts = createProjectDrafts();
  const secret = "sentinel-credential-recovery";

  drafts(FIRST.path).edit({ surface: "decisions", object: "original-prompt", recipient: "original-agent" }, { password: secret }, null, "credential");
  mount(drafts);
  await screen.findByRole("tab", { name: FIRST.name });
  expect(document.body.innerHTML).not.toContain(secret);
});
