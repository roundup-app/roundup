import * as v from "valibot";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Requested } from "@contracts/project/Requested";
import { createProjectDrafts } from "../state/connectedProject";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";
import { RpcError } from "./seam";
import { openRecovery, recoveryLabel } from "../testing/recovery";

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

  // Blank text, like picks and unknown availability, never qualifies.
  failedSave(holder, { surface: "todos", object: "8", recipient: null }, { title: "  " });
  const app = mount(drafts);
  await screen.findByRole("tab", { name: FIRST.name });
  fireEvent.contextMenu(await screen.findByRole("button", { name: /^Overview/ }), { clientX: 10, clientY: 10 });
  expect(app.shownMenus).toEqual([]);

  failedSave(holder, { surface: "todos", object: "9", recipient: null }, { title: "lost when closed" });
  await openRecovery();
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });

  expect(within(recovery).getAllByRole("listitem")).toHaveLength(1);
  expect(app.shownMenus.at(-1)!.items.map((item) => item.label)).toEqual(["Recover work (1)"]);
  expect(holder.list()).toHaveLength(2);
});

it("u3289c_overview_menu_opens_from_the_keyboard", async () => {
  const drafts = createProjectDrafts();
  failedSave(drafts(FIRST.path), { surface: "todos", object: "9", recipient: null }, { title: "lost when closed" });
  const app = mount(drafts);
  const overview = await screen.findByRole("button", { name: /^Overview/ });

  overview.focus();
  fireEvent.keyDown(overview, { key: "F10", shiftKey: true });
  await vi.waitFor(() => expect(app.shownMenus.at(-1)?.items.map((item) => item.label)).toEqual(["Recover work (1)"]));
});

it("u3289a_left_or_crashed_input_qualifies", async () => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const destination = { surface: "todos", object: "7", recipient: null };
  const typing = holder.editor(destination);

  holder.edit(destination, { title: "still typing" }, null, "ordinary");
  const app = mount(drafts);
  fireEvent.contextMenu(await screen.findByRole("button", { name: /^Overview/ }), { clientX: 10, clientY: 10 });
  expect(app.shownMenus).toEqual([]);

  typing();
  await openRecovery();
  expect(within(await screen.findByRole("region", { name: "Unfinished work" })).getAllByRole("listitem")).toHaveLength(1);
});

it("u3289b_recovery_entry_is_never_rendered", async () => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  mount(drafts);
  await screen.findByRole("tab", { name: FIRST.name });
  await screen.findAllByText(/^(new )?Workstream$/);
  await new Promise((done) => setTimeout(done, 300));
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((found) => records.push(...found));

  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  holder.edit({ surface: "orders", object: "gone-agent", recipient: "gone-agent" }, { ask: "left behind" }, null, "ordinary");
  await new Promise((done) => setTimeout(done, 50));
  records.push(...observer.takeRecords());
  observer.disconnect();
  expect(records).toEqual([]);
  expect(screen.queryByText(/Recover (unfinished )?work/)).toBeNull();

  await openRecovery();
  await screen.findByRole("region", { name: "Unfinished work" });
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

  await openRecovery();
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });
  const alert = await within(recovery).findByRole("alert");

  expect(alert.textContent).not.toContain(FIRST.path);
  expect(within(recovery).queryByRole("button", { name: /Inspect|Copy .+/ })).toBeNull();
  fireEvent.click(within(recovery).getByRole("button", { name: "Try again" }));
  expect(holder.list().map((draft) => draft.revision)).toEqual([saved]);
  expect(window.localStorage.getItem(`roundup:drafts:${FIRST.path}`)).toBe(bytes);
  fireEvent.click(within(recovery).getByRole("button", { name: "Discard" }));
  expect(holder.list()).toEqual([]);
  expect(app.calls.filter(({ method }) => method === "agent.setOrder" || method === "message.send")).toEqual([]);
  window.localStorage.clear();
});

it("u2773h_credential_values_remain_hidden_until_copy", async () => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const secret = "sentinel-credential-recovery";
  const { revision } = holder.edit({ surface: "agent", object: "original-prompt", recipient: "original-agent" }, { password: secret }, null, "credential").draft;

  holder.submit(revision);
  holder.settle(revision, "failed");
  const app = mount(drafts);
  const clipboard = vi.fn(async (_text: string) => {});

  vi.spyOn(app, "clipboardWrite").mockImplementation(clipboard);
  await openRecovery();
  const recovery = await screen.findByRole("region", { name: "Unfinished work" });

  expect(document.body.innerHTML).not.toContain(secret);
  fireEvent.click(within(recovery).getByRole("button", { name: "Copy" }));
  expect(clipboard).toHaveBeenCalledWith(secret);
});

it.each(["pads", "todos"])("u3021c_open_restores_exact_revision_without_rpc_%s_creation", async (surface) => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const exact = "  Naïve 🪁 name  ";
  const revision = failedSave(holder, surface === "pads" ? { surface, object: "creation", recipient: null } : { surface, object: "new", recipient: null }, surface === "pads" ? { name: exact, home: null } : { title: exact, home: null });
  const app = mount(drafts);

  await openRecovery();
  const row = within(await screen.findByRole("region", { name: "Unfinished work" })).getAllByRole("listitem").find((item) => item.dataset.revision === revision)!;
  const before = app.calls.length;

  fireEvent.click(within(row).getByRole("button", { name: "Open" }));
  await vi.waitFor(() => expect([...document.querySelectorAll<HTMLInputElement>("input, textarea")].some((field) => field.value === exact)).toBe(true));
  expect(app.calls.slice(before).filter(({ method }) => !/\.(list|read|get)/.test(method))).toEqual([]);
  expect(holder.list().map((draft) => draft.revision)).toContain(revision);
});

const owners = {
  pad: async () => {
    fireEvent.click(await screen.findByRole("tab", { name: "Pads" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));

    return screen.findByLabelText<HTMLInputElement>("Pad name");
  },
  todo: async () => {
    fireEvent.click(await screen.findByRole("button", { name: "add todo to Overview" }));

    return screen.findByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  },
  name: async () => {
    fireEvent.dblClick(document.querySelector(".tab-name")!);

    return screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  },
};

it.each(Object.entries(owners))("u3021d_acknowledged_typing_has_no_outside_mutations_%s", async (_owner, openField) => {
  mount(createProjectDrafts());
  await screen.findByRole("tab", { name: FIRST.name });
  await screen.findAllByText(/^(new )?Workstream$/);
  const field = await openField();

  await new Promise((done) => setTimeout(done, 300));
  const outside: MutationRecord[] = [];
  const observer = new MutationObserver((records) => outside.push(...records.filter((record) => !field.contains(record.target) && record.target !== field)));

  observer.observe(document.body, { subtree: true, childList: true, characterData: true });

  for (let count = 1; count <= 20; count++) {
    fireEvent.input(field, { target: { value: "x".repeat(count) } });
    await new Promise((done) => setTimeout(done));
  }

  await new Promise((done) => setTimeout(done, 50));
  outside.push(...observer.takeRecords().filter((record) => !field.contains(record.target) && record.target !== field));
  observer.disconnect();
  expect(outside.map((record) => `${record.type}:${record.target.nodeName}:${record.addedNodes.length}:${record.removedNodes.length}`)).toEqual([]);
});

it.each(Object.entries(owners))("u3289a_open_editor_stays_off_the_list_until_the_app_restarts_%s", async (_owner, openField) => {
  mount(createProjectDrafts());
  await screen.findByRole("tab", { name: FIRST.name });
  await screen.findAllByText(/^(new )?Workstream$/);
  fireEvent.input(await openField(), { target: { value: "unsent words" } });
  await new Promise((done) => setTimeout(done, 100));
  expect(await recoveryLabel()).toBeNull();
  cleanup();
  mount(createProjectDrafts());
  await screen.findByRole("tab", { name: FIRST.name });
  await vi.waitFor(async () => expect(await recoveryLabel()).toBe("Recover work (1)"));
});

it("u3289c_overview_menu_opens_recovery", async () => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const app = mount(drafts);
  const overview = await screen.findByRole("button", { name: /^Overview/ });

  expect(await recoveryLabel()).toBeNull();
  expect(app.shownMenus).toEqual([]);
  failedSave(holder, { surface: "todos", object: "9", recipient: null }, { title: "lost when closed" });
  failedSave(holder, { surface: "todos", object: "10", recipient: null }, { title: "lost too" });
  expect(await recoveryLabel()).toBe("Recover work (2)");
  fireEvent.click(overview);
  expect(screen.queryByRole("region", { name: "Unfinished work" })).toBeNull();
  await openRecovery();
  expect(within(await screen.findByRole("region", { name: "Unfinished work" })).getAllByRole("listitem")).toHaveLength(2);
});


it.each([
  { name: "Unicode", note: "  note é 🪁\nlast  ", excerpt: "  output 👩🏽‍💻\n exact  " },
  { name: "whitespace", note: "  \n  ", excerpt: " \t " },
])("u3529d_retired_selection_drafts_remain_copyable: $name", async ({ note, excerpt }) => {
  const drafts = createProjectDrafts();
  const holder = drafts(FIRST.path);
  const destination = { surface: "terminal_selection", object: "retired", recipient: "original-agent" };
  const a = holder.edit(destination, { note, excerpt }, null, "ordinary").draft;
  holder.submit(a.revision);
  holder.settle(a.revision, "unknown");
  const retained = holder.edit(destination, { note: "newer", excerpt: "kept" }, null, "ordinary");
  await retained.retained;
  const b = retained.draft;
  const saved = holder.list();
  const reopened = createProjectDrafts();
  const copied = vi.fn(async (_text: string) => {});

  const app = mount(reopened);
  vi.spyOn(app, "clipboardWrite").mockImplementation(copied);
  await openRecovery();
  const panel = await screen.findByRole("region", { name: "Unfinished work" });
  const row = panel.querySelector<HTMLElement>(`[data-revision="${a.revision}"]`)!;
  expect(reopened(FIRST.path).list().find(draft => draft.revision === a.revision)?.destination).toEqual(destination);
  fireEvent.click(within(row).getByRole("button", { name: "Copy" }));
  expect(copied).toHaveBeenCalledWith(note + "\n" + excerpt);
  expect(reopened(FIRST.path).list()).toEqual(saved);
  expect(app.calls.filter(call => ["message.send", "agent.prompt", "agent.spawn", "agent.setOrder", "terminal.open", "terminal.write"].includes(call.method))).toEqual([]);
  fireEvent.click(within(row).getByRole("button", { name: "Discard" }));
  expect(reopened(FIRST.path).list()).toEqual([b]);
});
