import { copy as recoveryCopy } from "../sharedCopy";
import { settled } from "../rail/railFixture";
import { cleanup, render, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createRoot, createSignal } from "solid-js";
import { createProjectDrafts, ProjectDraftsContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { Tabs } from "../ui/Tabs";
import { ProjectTab } from "./ProjectTab";
import { createProjectsState } from "../state/projects";
import { RpcError } from "../app/seam";
import { renderTabs, openTabs, path, tab, projectTabs } from "./stripFixture";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const field = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" });

const edit = async (name = "api") => {
  await settled();
  const target = await screen.findByRole("tab", { name: new RegExp(`^${name}`) });
  fireEvent.dblClick(target.querySelector(".tab-name")!);

  return await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
};

const press = (key: string) => fireEvent.keyDown(field(), { key });

describe("u183 rename in place", () => {
  it("u183_double_click_opens_a_field_with_the_current_name_selected", async () => {
    await openTabs({ api: [], web: [] });

    const input = await edit();

    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe("api");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(3);
  });

  it("u183_enter_saves_and_returns_focus_to_the_tab", async () => {
    const { app } = await openTabs({ api: [], web: [] });
    const input = await edit();

    input.value = "payments";
    press("Enter");

    await waitFor(() => expect(projectTabs().map((entry) => entry.textContent)).toEqual(["payments", "web"]));
    expect(document.activeElement).toBe(tab("payments"));
    expect(await app.projects()).toContainEqual({ name: "payments", path: path("api"), running: true });
  });

  it("u183_an_empty_name_returns_the_folder_name", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    const first = await edit();

    first.value = "payments";
    press("Enter");
    await waitFor(() => expect(tab("payments")).toBeDefined());

    const input = await edit("payments");

    input.value = "   ";
    press("Enter");

    await waitFor(() => expect(within(screen.getByRole("tablist", { name: "Projects" })).getAllByRole("tab").map((entry) => entry.textContent)).toEqual(["api", "web"]));
    expect(await app.projects()).toContainEqual({ name: "api", path: path("api"), running: true });
  });

  it("u183_a_failed_call_restores_the_name_and_shows_the_line_after_the_strip", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    app.renameProject = async () => {
      throw new RpcError(-32602, "name is longer than 40 characters");
    };

    const input = await edit();

    input.value = "x".repeat(41);
    press("Enter");

    expect(await screen.findByText("name is longer than 40 characters")).toBeDefined();
    expect(tab("api").textContent).toBe("api");
    expect(within(screen.getByRole("region", { name: "Rail" })).getByText("name is longer than 40 characters")).toBeDefined();
  });

  it("u183_a_click_elsewhere_saves_like_enter", async () => {
    await openTabs({ api: [], web: [] });
    const input = await edit();

    input.value = "payments";
    fireEvent.blur(input);

    await waitFor(() => expect(tab("payments")).toBeDefined());
  });
});


it.each<[boolean, RpcError]>([
  [false, new RpcError(-32603, "disconnected")],
  [true, new RpcError(-32000, "request timed out")],
])("u2773b_header_settlement_preserves_other_revisions_other_project_%s", async (switchProject, unknownError) => {
  const { app } = await openTabs({ api: [], web: [] });
  let dispose = () => {};

  const state = createRoot((stop) => {
    dispose = stop;

    return createProjectsState(app);
  });

  await waitFor(() => expect(state.loaded()).toBe(true));
  state.select(path("api"));
  const rename = state.rename;
  const calls: { path: string; name: string; accept: (project: { path: string; name: string }) => void; reject: (error: Error) => void }[] = [];
  app.renameProject = (path, name) => new Promise((accept, reject) => { calls.push({ path, name, accept, reject }); });
  const a = rename(path("api"), " A 雪 ");
  const b = rename(path("api"), "B");

  if (switchProject) state.select(path("web"));
  expect(state.active()).toBe(path(switchProject ? "web" : "api"));
  calls[1]!.accept({ path: path("api"), name: "B" });
  const acknowledged = await b;
  expect(acknowledged).toMatchObject({ status: "acknowledged", path: path("api"), name: "B" });
  calls[0]!.reject(new RpcError(-32602, "rejected"));
  const rejected = await a;
  expect(rejected).toMatchObject({ status: "failed", path: path("api"), name: " A 雪 " });
  expect(rejected!.revision).not.toBe(acknowledged!.revision);
  expect(state.tabs().find(tab => tab.project.path === path("api"))?.project.name).toBe("B");
  expect(state.tabs().find(tab => tab.project.path === path("web"))?.project.name).toBe("web");
  const clean = rename(path("api"), "refused");
  calls[2]!.reject(new RpcError(-32602, "rejected"));
  expect(await clean).toMatchObject({ status: "failed", path: path("api"), name: "refused" });
  expect(state.tabs().find(tab => tab.project.path === path("api"))?.project.name).toBe("B");
  const read = app.projects;
  let reads = 0;
  app.projects = async () => {
    reads++;

    return [{ path: path("api"), name: "C", running: true }, ...(await read()).filter(project => project.path !== path("api"))];
  };

  const unknown = rename(path("api"), "C");
  calls[3]!.reject(unknownError);
  expect(await unknown).toMatchObject({ status: "unknown", path: path("api"), name: "C" });
  expect(reads).toBe(1);
  expect(state.tabs().find(tab => tab.project.path === path("api"))?.project.name).toBe("C");
  app.projects = async () => {
    reads++;
    throw new RpcError(-32603, "read disconnected");
  };

  const unavailable = rename(path("api"), "D");
  calls[4]!.reject(unknownError);
  expect(await unavailable).toMatchObject({ status: "unknown", path: path("api"), name: "D" });
  expect(reads).toBe(2);
  expect(state.tabs().find(tab => tab.project.path === path("api"))?.project.name).toBe("C");
  let finishRead: (projects: Awaited<ReturnType<typeof app.projects>>) => void = () => {};

  app.projects = () => new Promise(resolve => { reads++; finishRead = resolve; });
  const reconciling = rename(path("api"), "E");
  calls[5]!.reject(unknownError);
  await waitFor(() => expect(reads).toBe(3));
  app.projects = async () => [{ path: path("api"), name: "F", running: true }];
  const laterUnknown = rename(path("api"), "F");
  calls[6]!.reject(unknownError);
  expect(await laterUnknown).toMatchObject({ status: "unknown", name: "F" });
  const latest = rename(path("api"), "G");
  calls[7]!.accept({ path: path("api"), name: "G" });
  expect(await latest).toMatchObject({ status: "acknowledged", name: "G" });
  finishRead([{ path: path("api"), name: "E", running: true }]);
  expect(await reconciling).toMatchObject({ status: "unknown", name: "E" });
  expect(state.tabs().find(tab => tab.project.path === path("api"))?.project.name).toBe("G");
  dispose();
  expect(calls.map(({ path, name }) => [path, name])).toEqual([[path("api"), " A 雪 "], [path("api"), "B"], [path("api"), "refused"], [path("api"), "C"], [path("api"), "D"], [path("api"), "E"], [path("api"), "F"], [path("api"), "G"]]);
});


it("u2773b_header_late_rejection_keeps_acknowledged_project_title", async () => {
  const { app } = await openTabs({ api: [], web: [] });
  fireEvent.click(tab("api"));
  const replies: { accept: (project: { path: string; name: string }) => void; reject: (error: Error) => void }[] = [];
  app.renameProject = () => new Promise((accept, reject) => { replies.push({ accept, reject }); });
  const a = await edit();
  a.value = "A";
  press("Enter");
  const b = await edit("A");
  b.value = "B";
  press("Enter");
  fireEvent.click(tab("web"));
  await waitFor(() => expect(replies).toHaveLength(2));
  replies[1]!.accept({ path: path("api"), name: "B" });
  await waitFor(() => expect(tab("B")).toBeDefined());
  replies[0]!.reject(new RpcError(-32602, "older rename rejected"));
  await screen.findByText("older rename rejected");
  expect(tab("B")).toBeDefined();
  fireEvent.click(tab("B"));
  await waitFor(() => expect(document.querySelector(".window-title")?.textContent).toBe(b.value));
  expect(replies).toHaveLength(2);
});


// Production opening inventory: focused-tab F2, name double-click, native menu Rename.
// Recovery in the mounted Strip is copy/discard-only; it opens no additional rename target.
it.each(["F2", "double-click", "native Rename"] as const)("u3787c_escape_restores_the_name_project_%s", async opening => {
  const { app, view } = await openTabs({ api: [], web: [] });
  const sends = vi.spyOn(app, "renameProject");
  fireEvent.click(tab("api"));
  await settled();
  const original = tab("api");
  const saved = original.textContent;
  original.focus();

  if (opening === "F2") fireEvent.keyDown(original, { key: "F2" });
  else if (opening === "double-click") fireEvent.dblClick(original.querySelector(".tab-name")!);
  else {
    fireEvent.contextMenu(original);
    await app.pickMenu("Rename");
  }

  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  const exact = "  e\u0301 🪁 雪\t  ";
  fireEvent.input(input, { target: { value: exact } });
  input.setSelectionRange(2, 6, "backward");
  fireEvent.select(input);
  const underlying = vi.fn();
  document.addEventListener("keydown", underlying);

  try { press("Escape"); }
  finally { document.removeEventListener("keydown", underlying); }

  expect(tab("api").textContent).toBe(saved);
  expect(document.activeElement).toBe(tab("api"));
  expect(tab("api").getAttribute("aria-selected")).toBe("true");
  expect(underlying).not.toHaveBeenCalled();
  expect(sends).not.toHaveBeenCalled();
  const records = () => JSON.parse(window.localStorage.getItem(`roundup:drafts:${path("api")}`)!).drafts;
  await waitFor(() => expect(records()).toEqual([expect.objectContaining({ destination: { surface: "header", object: path("api"), recipient: null },
    value: { name: exact, base: "api" }, selection: { start: 2, end: 6, direction: "backward" }, status: "draft" })]));
  const retained = records()[0];
  fireEvent.click(tab("web"));
  await settled();
  fireEvent.click(tab("api"));
  const restored = await edit();
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([exact, 2, 6, "backward"]);
  fireEvent.blur(restored);
  expect(records()).toEqual([retained]);
  expect(sends).not.toHaveBeenCalled();
  view.unmount();
  const { app: reopened } = await openTabs({ api: [], web: [] }, true);
  const restoredSends = vi.spyOn(reopened, "renameProject");
  const reloaded = await edit();
  expect([reloaded.value, reloaded.selectionStart, reloaded.selectionEnd, reloaded.selectionDirection]).toEqual([exact, 2, 6, "backward"]);
  expect(restoredSends).not.toHaveBeenCalled();
});


it("u2773c_header_external_change_keeps_original", async () => {
  const { app } = await openTabs({ api: [], web: [] });
  const original = path("api");
  tab("api").focus();
  fireEvent.keyDown(tab("api"), { key: "F2" });
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });

  await app.renameProject(original, "B");
  fireEvent.input(input, { target: { value: " exact 雪 " } });
  press("Enter");

  await screen.findByText("Project name changed");
  expect((await app.projects()).find(project => project.path === original)?.name).toBe("B");
  expect(tab("B")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · B" }));
  const recovery = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(within(recovery).getByText(" exact 雪 ", { exact: true, normalizer: text => text })).toBeDefined();
  expect(within(recovery).getByRole("status", { name: "Failed" })).toBeDefined();
});

it("u2773c_header_late_conflict_read_cannot_replace_newer_acknowledgement", async () => {
  const { app } = await openTabs({ api: [], web: [] });
  const original = path("api");
  const calls: { base: string | undefined; accept: (project: { path: string; name: string }) => void; reject: (error: Error) => void }[] = [];
  app.renameProject = (_path, _name, base) => new Promise((accept, reject) => { calls.push({ base, accept, reject }); });
  let finishRead: ((projects: Awaited<ReturnType<typeof app.projects>>) => void) | undefined;
  app.projects = () => new Promise(resolve => { finishRead = resolve; });
  tab("api").focus();
  fireEvent.keyDown(tab("api"), { key: "F2" });
  const older = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  fireEvent.input(older, { target: { value: "A 雪" } });
  press("Enter");
  await waitFor(() => expect(calls).toHaveLength(1));
  calls[0]!.reject(new RpcError(-32003, "Project name changed"));
  await waitFor(() => expect(finishRead).toBeDefined());
  const newer = await edit("api");
  fireEvent.input(newer, { target: { value: "B" } });
  press("Enter");
  await waitFor(() => expect(calls).toHaveLength(2));
  calls[1]!.accept({ path: original, name: "B" });
  await screen.findByRole("tab", { name: "B" });
  fireEvent.click(tab("web"));
  finishRead!([{ path: original, name: "external", running: true }]);
  await screen.findByRole("tab", { name: "web" });
  expect(tab("B")).toBeDefined();
  expect(calls.map(call => call.base)).toEqual(["api", "api"]);
});


it.each(["failed", "unknown", "acknowledged"] as const)("u2773b_header_settlement_preserves_other_revisions_%s", async outcome => {
  const { app, view } = await openTabs({ api: [], web: [] });
  let accept: ((project: { name: string; path: string }) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const sends: unknown[][] = [];
  app.renameProject = (...args) => { sends.push(args);

 return new Promise((yes, no) => { accept = yes; reject = no; }); };

  const firstText = "  A e\u0301 🪁  ";
  const nextText = "  B 雪  ";
  const a = await edit();
  fireEvent.input(a, { target: { value: firstText } });
  press("Enter");
  const b = await edit("A");
  fireEvent.input(b, { target: { value: nextText } });
  press("Escape");
  fireEvent.click(tab("web"));

  if (outcome === "acknowledged") accept!({ path: path("api"), name: "A e\u0301 🪁" });
  else reject!(new RpcError(outcome === "failed" ? -32602 : -32603, outcome));
  await waitFor(() => expect(document.querySelector(`[data-path="${path("api")}"]`)?.textContent).toContain(outcome === "acknowledged" ? "A e\u0301 🪁" : "api"));
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem(`roundup:drafts:${path("api")}`)!).drafts.some((draft: { status: string }) => draft.status === "pending")).toBe(false));
  view.unmount();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  fireEvent.click(await screen.findByRole("tab", { name: "api" }));
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work · api" }));
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(within(dialog).getByText(nextText, { exact: true, normalizer: text => text })).toBeDefined();
  const older = within(dialog).queryByRole("button", { name: new RegExp(`^${outcome === "failed" ? "Failed" : recoveryCopy.draftStatus.unknown} ·`) });

  if (outcome === "acknowledged") expect(older).toBeNull();
  else {
    fireEvent.click(older!);
    expect(within(dialog).getByText(firstText, { exact: true, normalizer: text => text })).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: recoveryCopy.discardRevision }));
    expect(within(dialog).getByText(nextText, { exact: true, normalizer: text => text })).toBeDefined();
  }

  expect(sends).toEqual([[path("api"), "  A e\u0301 🪁  ", "api"]]);
});

it("u2773e_recovery_actions_keep_surface_draft_header", async () => {
  const { app } = await openTabs({ api: [], web: [] });
  const sends = vi.spyOn(app, "renameProject");
  fireEvent.click(tab("api"));
  const input = await edit();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.input(input, { target: { value: "  recover e\u0301 🪁  " } });
  press("Escape");
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · api" }));
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  const copied: string[] = [];
  vi.spyOn(app, "clipboardWrite").mockImplementation(async (value: string) => { copied.push(value); });
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
  await waitFor(() => expect(copied).toEqual(["  recover e\u0301 🪁  "]));
  await within(dialog).findByRole("button", { name: "Retry storage only" });
  write.mockRestore();
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry storage only" }));
  await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
  expect(JSON.parse(window.localStorage.getItem(`roundup:drafts:${path("api")}`)!).drafts[0].value.name).toBe("  recover e\u0301 🪁  ");
  fireEvent.click(within(dialog).getByRole("button", { name: recoveryCopy.discardRevision }));
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem(`roundup:drafts:${path("api")}`)!).drafts).toEqual([]));
  expect(sends).not.toHaveBeenCalled();

});





it("u2773e_header_incompatible_form_preserves_stored_bytes", async () => {
  renderTabs({ api: [], web: [] });
  const key = `roundup:drafts:${path("api")}`;
  const original = JSON.stringify({ version: 1, drafts: [{ revision: "incompatible-header", destination: { surface: "header", object: path("api"), recipient: null }, value: { name: 42 }, selection: null, status: "draft", policy: "ordinary" }] });
  window.localStorage.setItem(key, original);
  await screen.findByRole("tab", { name: "api" });
  fireEvent.click(tab("api"));
  const input = await edit();
  fireEvent.input(input, { target: { value: "  memory 雪  " } });
  press("Escape");
  expect(window.localStorage.getItem(key)).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · api" }));
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(within(dialog).getByText("  memory 雪  ", { exact: true, normalizer: text => text })).toBeDefined();
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry storage only" }));
  expect(window.localStorage.getItem(key)).toBe(original);
  expect(within(dialog).getByRole("alert")).toBeDefined();
});

it("u2773c_header_legacy_recovery_never_guesses_a_base", async () => {
  const value = { name: "  legacy 雪  " };
  const { app } = renderTabs({ api: [], web: [] });
  window.localStorage.setItem(`roundup:drafts:${path("api")}`, JSON.stringify({ version: 1, drafts: [{ revision: "legacy-header", destination: { surface: "header", object: path("api"), recipient: null }, value, selection: null, status: "draft", policy: "ordinary" }] }));
  const sends = vi.spyOn(app, "renameProject");
  await screen.findByRole("tab", { name: "api" });
  const input = await edit();
  expect(input.value).toBe(value.name);
  press("Enter");
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(within(dialog).getAllByRole("status").some(status => status.textContent?.includes(recoveryCopy.railDraftConflict))).toBe(true);
  expect(within(dialog).getByText(value.name, { exact: true, normalizer: text => text })).toBeDefined();
  expect(sends).not.toHaveBeenCalled();
});


const selectedHeader = async (outcome: "failed" | "unknown" = "failed") => {
  window.localStorage.clear();
  const app = vi.mockObject(createFakeApp(), { spy: true });
  app.add(path("api"), "same name");
  app.add(path("web"), "same name");
  const authority = createProjectDrafts();
  const drafts = authority(path("api"));
  const destination = { surface: "header", object: path("api"), recipient: null };

  const a = drafts.edit(destination, { name: "  A e\u0301 🪁 雪  ", base: "same name" },
    { start: 2, end: 7, direction: "backward" }, "ordinary").draft;

  drafts.submit(a.revision);
  drafts.settle(a.revision, outcome);

  const b = drafts.edit(destination, { name: "  B 雪  ", base: "same name" },
    { start: 1, end: 4, direction: "forward" }, "ordinary").draft;

  const [recovery, recover] = createSignal<{ project: string; revision: string }>();
  let projects!: ReturnType<typeof createProjectsState>;

  const view = render(() => {
    projects = createProjectsState(app);

    return <ProjectDraftsContext.Provider value={authority}><Tabs.Root value={path("api")}><Tabs.List aria-label="Projects">
      <ProjectTab tab={{ path: path("api"), name: "same name", base: "same name", busy: false, running: [], needsYou: 0, error: 0, exitText: null }}
        selected app={app} recovery={recovery()} onMark={() => {}} onClose={() => {}}
        onRename={(name, base) => projects.rename(path("api"), name, base)} />
    </Tabs.List></Tabs.Root></ProjectDraftsContext.Provider>;
  });

  await waitFor(() => expect(projects.loaded()).toBe(true));

  const appCalls = () => ({ app: Object.entries(app).flatMap(([method, call]) =>
    vi.isMockFunction(call) ? [{ method, args: [...call.mock.calls] }] : []), rpc: [...app.calls] });

  const open = (revision: string, project = path("api")) => recover({ project, revision });

  return { app, authority, drafts, destination, a: drafts.list().find(draft => draft.revision === a.revision)!, b, open, view, calls: appCalls };
};

it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_header_%s", async outcome => {
  const { drafts, a, b, open, calls } = await selectedHeader(outcome);
  const before = drafts.list();
  const beforeCalls = calls();
  open(a.revision);
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect([input.value, input.selectionStart, input.selectionEnd, input.selectionDirection])
    .toEqual([a.value.name, 2, 7, "backward"]);
  input.focus();
  fireEvent.blur(input);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(drafts.list()).toEqual(before);
  open(b.revision);
  const newer = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  expect([newer.value, newer.selectionStart, newer.selectionEnd, newer.selectionDirection])
    .toEqual([b.value.name, 1, 4, "forward"]);
  press("Escape");
  expect(drafts.list()).toEqual(before);
  expect(calls()).toEqual(beforeCalls);
});

it.each(["failed", "unknown"] as const)("u3021c_header_editing_selected_revision_keeps_newer_work_and_requires_confirmation_%s", async outcome => {
  const { drafts, a, b, open, calls } = await selectedHeader(outcome);
  const beforeCalls = calls();
  open(a.revision);
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  fireEvent.input(input, { target: { value: "  edited A 🧭  " } });
  input.setSelectionRange(1, 6, "backward");
  fireEvent.select(input);
  fireEvent.blur(input);
  const edited = drafts.list().find(draft => draft.value.name === "  edited A 🧭  ")!;
  expect(edited.selection).toEqual({ start: 1, end: 6, direction: "backward" });
  expect(drafts.list()).toContainEqual(b);
  expect(drafts.list()).toContainEqual(a);
  open(b.revision);
  const newer = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  expect([newer.value, newer.selectionStart, newer.selectionEnd, newer.selectionDirection]).toEqual([b.value.name, 1, 4, "forward"]);
  open(edited.revision);
  await waitFor(() => expect(field().value).toBe("  edited A 🧭  "));
  expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([1, 6, "backward"]);
  press("Escape");
  const resumed = await edit("same name");
  fireEvent.input(resumed, { target: { value: "  edited A again 🧭  " } });
  press("Escape");
  expect(drafts.list()).toContainEqual(b);
  expect(calls()).toEqual(beforeCalls);
});

it.each(["acknowledged", "failed", "unknown"] as const)("u3021c_header_confirmation_settles_only_submitted_edit_%s", async outcome => {
  const { app, drafts, a, b, open } = await selectedHeader();
  app.renameProject = vi.fn(async () => {
    if (outcome !== "acknowledged") throw new RpcError(outcome === "failed" ? -32602 : -32603, outcome);

    return { path: path("api"), name: "edited A" };
  });
  open(a.revision);
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  fireEvent.input(input, { target: { value: "edited A" } });
  const submitted = drafts.list().find(draft => draft.value.name === "edited A")!;
  press("Enter");
  await waitFor(() => expect(drafts.list().find(draft => draft.revision === submitted.revision)?.status)
    .toBe(outcome === "acknowledged" ? undefined : outcome));
  expect(app.renameProject).toHaveBeenCalledExactlyOnceWith(path("api"), "edited A", "same name");
  expect(drafts.list()).toContainEqual(a);
  expect(drafts.list()).toContainEqual(b);
});

it("u3021c_header_selected_edit_preserves_captured_base_conflict_refusal", async () => {
  const { app, drafts, a, b, open } = await selectedHeader();
  await app.renameProject(path("api"), "external");
  const sends = vi.spyOn(app, "renameProject");
  open(a.revision);
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  fireEvent.input(input, { target: { value: "my edit" } });
  press("Enter");
  await waitFor(() => expect(drafts.list().find(draft => draft.value.name === "my edit")?.status).toBe("failed"));
  expect(sends).toHaveBeenLastCalledWith(path("api"), "my edit", "same name");
  expect((await app.projects()).find(project => project.path === path("api"))?.name).toBe("external");
  expect(drafts.list()).toContainEqual(b);
});

it("u3021c_header_unknown_acceptance_is_never_retried_unchanged", async () => {
  const { a, open, calls } = await selectedHeader("unknown");
  const before = calls();
  open(a.revision);
  await screen.findByRole("textbox", { name: "Project name" });
  press("Enter");
  await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(calls()).toEqual(before);
});

it.each(["project", "object", "recipient", "missing-base", "missing-revision"] as const)("u3021c_header_rejects_selected_revision_with_wrong_authority_%s", async mismatch => {
  const { drafts, destination, a, open, calls } = await selectedHeader();

  const wrong = drafts.edit({ ...destination, object: mismatch === "object" ? path("web") : destination.object,
    recipient: mismatch === "recipient" ? "someone else" : null },
    mismatch === "missing-base" ? { name: "same name" } : { name: "same name", base: "same name" }, null, "ordinary", null).draft;

  const before = drafts.list();
  const beforeCalls = calls();
  open(mismatch === "project" ? a.revision : mismatch === "missing-revision" ? "absent" : wrong.revision,
    mismatch === "project" ? path("web") : path("api"));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(drafts.list()).toEqual(before);
  expect(calls()).toEqual(beforeCalls);
});

it("u3021c_copy_and_discard_keep_other_revisions_header_after_reopen", async () => {
  const { app, authority, drafts, destination, a, b, view } = await selectedHeader();
  const other = authority(path("web"));
  const elsewhere = other.edit({ ...destination, object: path("web") }, { name: "other Project", base: "same name" }, null, "ordinary").draft;
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · same name" }));
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  fireEvent.click(within(dialog).getByRole("button", { name: /^Failed ·/ }));
  const copied: string[] = [];
  vi.spyOn(app, "writeClipboardText").mockImplementation(async (text: string) => { copied.push(text); });
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
  await waitFor(() => expect(copied).toEqual([a.value.name]));
  fireEvent.click(within(dialog).getByRole("button", { name: recoveryCopy.discardRevision }));
  expect(drafts.list()).toEqual([b]);
  await waitFor(() => expect(createProjectDrafts()(path("api")).list()).toEqual([b]));
  view.unmount();
  const reopened = createProjectDrafts();
  expect(reopened(path("api")).list()).toEqual([b]);
  expect(reopened(path("web")).list()).toEqual([elsewhere]);
});

it("u3299d_copy_uses_selected_item_project", async () => {
  const app = createFakeApp();
  const [selected, select] = createSignal("/one");
  render(() => <Tabs.Root value={selected()} onValueChange={details => select(details.value)}><Tabs.List aria-label="Projects">
    {["/one", "/two"].map(project => <ProjectTab tab={{ path: project, name: "Review", busy: false, running: [], needsYou: 0, error: 0, exitText: null }}
      selected={selected() === project} app={app} onMark={() => {}} onRename={async () => ({ status: "acknowledged", path: project, name: "Review", revision: 1, project: { path: project, name: "Review" } })} onClose={() => {}} />)}
  </Tabs.List></Tabs.Root>);
  const copied: string[] = [];
  vi.spyOn(app, "clipboardWrite").mockImplementation(async (text: string) => { copied.push(text); });
  const tabs = screen.getAllByRole("tab", { name: "Review" });
  fireEvent.click(tabs[1]!);
  fireEvent.contextMenu(tabs[1]!);
  await app.pickMenu("Copy");
  expect(selected()).toBe("/two");
  expect(copied.map(text => JSON.parse(text))).toEqual([{ name: "Review", path: "/two" }]);
});


it.each([
  ["dismiss", true],
  ["discard copied revision", true],
  ["discard other revision", false],
  ["acknowledged save", true],
  ["failed save", false],
  ["unknown save", false],
  ["other Project save", false],
] as const)("p3557c_failure_lifetime_header_%s", async (action, clears) => {
  const { app } = renderTabs({ api: [], web: [] });
  const key = (project: string) => `roundup:drafts:${path(project)}`;

  const retained = (project: string, revision: string, name: string, status = "draft") => ({
    revision, destination: { surface: "header", object: path(project), recipient: null },
    value: { name, base: project }, selection: { start: 2, end: 5, direction: "backward" }, status, policy: "ordinary",
  });

  const a = retained("api", "copied", "  A e\u0301 🪁 雪  ", "failed");
  const b = retained("api", "newer", "  B 雪  ");
  const elsewhere = retained("web", "elsewhere", "  other 🧭  ");
  window.localStorage.setItem(key("api"), JSON.stringify({ version: 1, drafts: [a, b] }));
  window.localStorage.setItem(key("web"), JSON.stringify({ version: 1, drafts: [elsewhere] }));
  await screen.findByRole("tab", { name: "api" });
  await waitFor(() => expect(projectTabs().every(tab => tab.getAttribute("aria-busy") === "false")).toBe(true));
  fireEvent.click(tab("api"));
  const records = (project: string) => JSON.parse(window.localStorage.getItem(key(project))!).drafts;
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work · api" }));
  let dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  fireEvent.click(within(dialog).getByRole("button", { name: /^Failed ·/ }));
  const blocked = vi.spyOn(app, "clipboardWrite").mockImplementation(async () => { throw new Error("clipboard blocked"); });
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
  await within(dialog).findByRole("alert", { name: /clipboard blocked/ });
  expect(blocked).toHaveBeenCalledExactlyOnceWith(a.value.name);

  if (action === "dismiss") fireEvent.click(within(dialog).getByRole("button", { name: "Close · Copy name" }));
  else if (action.startsWith("discard")) {
    if (action === "discard other revision") fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${recoveryCopy.currentDraft} ·`) }));
    fireEvent.click(within(dialog).getByRole("button", { name: recoveryCopy.discardRevision }));
  } else {
    fireEvent.click(within(dialog).getByRole("button", { name: /^Close$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const project = action === "other Project save" ? "web" : "api";
    fireEvent.click(tab(project));

    if (action === "failed save" || action === "unknown save") app.renameProject = vi.fn(async () => { throw new RpcError(action === "failed save" ? -32602 : -32603, action); });
    await edit(project);
    press("Enter");
    await waitFor(() => expect(records(project)).toEqual(project === "web" ? [] : action === "acknowledged save" ? [a] : [a, { ...b, status: action === "failed save" ? "failed" : "unknown" }]));
    fireEvent.click(document.querySelector(`[data-path="${path("api")}"] [role="tab"]`)!);
    fireEvent.click(await within(document.querySelector(`[data-path="${path("api")}"]`)!).findByRole("button", { name: /^Recover unfinished work ·/ }));
    dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  }

  await waitFor(() => expect(within(dialog).queryByRole("alert", { name: /clipboard blocked/ }) === null).toBe(clears));
  await waitFor(() => expect(records("api")).toEqual(action === "discard copied revision" ? [b] : action === "discard other revision" ? [a]
    : action === "acknowledged save" ? [a] : action === "failed save" || action === "unknown save" ? [a, { ...b, status: action === "failed save" ? "failed" : "unknown" }] : [a, b]));
  expect(records("web")).toEqual(action === "other Project save" ? [] : [elsewhere]);
});

it.each(["dismiss", "discard"] as const)("p3557c_failure_lifetime_header_retention_%s", async action => {
  const { app } = await openTabs({ api: [], web: [] });
  fireEvent.click(tab("web"));
  const other = await edit("web");
  fireEvent.input(other, { target: { value: "  other Project 雪  " } });
  press("Escape");
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem(`roundup:drafts:${path("web")}`)!).drafts.at(-1).value.name).toBe("  other Project 雪  "));
  const untouched = window.localStorage.getItem(`roundup:drafts:${path("web")}`);
  fireEvent.click(tab("api"));
  const input = await edit();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  const memory = "  memory e\u0301 🧭  ";
  fireEvent.input(input, { target: { value: memory } });
  press("Escape");
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work · api" }));
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  vi.spyOn(app, "clipboardWrite").mockImplementation(async () => { throw new Error("clipboard blocked"); });
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
  await within(dialog).findByRole("alert", { name: /clipboard blocked/ });
  expect(within(dialog).getByRole("alert", { name: /Storage could not save unfinished work/ })).toBeDefined();
  fireEvent.click(within(dialog).getByRole("button", { name: action === "dismiss" ? "Close · Copy name" : recoveryCopy.discardRevision }));
  await waitFor(() => expect(within(dialog).queryByRole("alert", { name: /clipboard blocked/ })).toBeNull());
  expect(within(dialog).getByRole("alert", { name: /Storage could not save unfinished work/ })).toBeDefined();
  expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Retry storage only" }).disabled).toBe(false);

  if (action === "dismiss") expect(within(dialog).getByText(memory, { exact: true, normalizer: text => text })).toBeDefined();
  expect(window.localStorage.getItem(`roundup:drafts:${path("web")}`)).toBe(untouched);
});

it.each(["dismiss", "close Project"] as const)("p3557c_failure_lifetime_header_menu_%s", async action => {
  const { app } = await openTabs({ api: [], web: [] });
  fireEvent.click(tab("web"));
  const input = await edit("web");
  const original = "  untouched 雪  ";
  fireEvent.input(input, { target: { value: original } });
  press("Escape");
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem(`roundup:drafts:${path("web")}`)!).drafts.at(-1).value.name).toBe("  untouched 雪  "));
  const untouched = window.localStorage.getItem(`roundup:drafts:${path("web")}`);
  fireEvent.click(tab("api"));
  vi.spyOn(app, "clipboardWrite").mockImplementation(async () => { throw new Error("clipboard blocked"); });
  await settled();
  fireEvent.contextMenu(tab("api"));
  await app.pickMenu("Copy");
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(within(dialog).getByRole("alert", { name: /clipboard blocked/ })).toBeDefined();
  fireEvent.click(within(dialog).getByRole("button", { name: /^Close$/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  if (action === "dismiss") {
    fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work · api" }));
    const reopened = await screen.findByRole("dialog", { name: "Unfinished work" });
    fireEvent.click(within(reopened).getByRole("button", { name: "Close · Copy name" }));
    expect(within(reopened).queryByRole("alert")).toBeNull();
  } else {
    await settled();
  fireEvent.contextMenu(tab("api"));
    await app.pickMenu("Close");
    await waitFor(() => expect(projectTabs()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · web" }));
    const reopened = await screen.findByRole("dialog", { name: "Unfinished work" });
    expect(within(reopened).queryByRole("alert")).toBeNull();
    expect(within(reopened).getByText(original, { exact: true, normalizer: text => text })).toBeDefined();
  }

  expect(window.localStorage.getItem(`roundup:drafts:${path("web")}`)).toBe(untouched);
});
