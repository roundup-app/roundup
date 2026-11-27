import { settled } from "../rail/railFixture";
import { cleanup, render, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createRoot, createSignal, flush } from "solid-js";
import { createProjectDrafts, ProjectDraftsContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { Tabs } from "../ui/Tabs";
import { ProjectTab } from "./ProjectTab";
import { createProjectsState } from "../state/projects";
import { RpcError } from "../app/seam";
import { openTabs, path, tab, projectTabs } from "./stripFixture";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const field = () => screen.getByLabelText<HTMLInputElement>("Project name", { selector: "input" });

const edit = async (name = "api") => {
  await settled();
  const target = await within(await screen.findByRole("tablist", { name: "Projects" })).findByRole("tab", { name: new RegExp(`^${name}`) });
  fireEvent.dblClick(target.querySelector(".tab-name")!);

  return await screen.findByLabelText<HTMLInputElement>("Project name", { selector: "input" });
};

const press = (key: string) => {
  fireEvent.keyDown(field(), { key });
  flush();
};

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
    const failure = new RpcError(-32602, "name is longer than 40 characters");

    app.renameProject = async () => {
      throw failure;
    };

    const input = await edit();

    input.value = "x".repeat(41);
    press("Enter");

    expect(await screen.findByText("name is longer than 40 characters")).toBeDefined();
    expect(tab("api").textContent).toBe("api");
    expect(within(screen.getByRole("region", { name: "Updates" })).getByText(failure.message)).toBeDefined();
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
  flush();
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
  await screen.findByRole("alert", { name: "older rename rejected" });
  expect(tab("B")).toBeDefined();
  fireEvent.click(tab("B"));
  flush();
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

  const input = await screen.findByLabelText<HTMLInputElement>("Project name", { selector: "input" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  const exact = "  e\u0301 🪁 雪\t  ";
  fireEvent.input(input, { target: { value: exact } });
  flush();
  input.setSelectionRange(2, 6, "backward");
  fireEvent.select(input);
  flush();
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
  flush();
  expect(records()).toEqual([retained]);
  expect(sends).not.toHaveBeenCalled();
  view.unmount();
  const { app: reopened } = await openTabs({ api: [], web: [] }, true);
  const restoredSends = vi.spyOn(reopened, "renameProject");
  const reloaded = await edit();
  expect([reloaded.value, reloaded.selectionStart, reloaded.selectionEnd, reloaded.selectionDirection]).toEqual([exact, 2, 6, "backward"]);
  expect(restoredSends).not.toHaveBeenCalled();
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
  const older = await screen.findByLabelText<HTMLInputElement>("Project name", { selector: "input" });
  fireEvent.input(older, { target: { value: "A 雪" } });
  flush();
  press("Enter");
  await waitFor(() => expect(calls).toHaveLength(1));
  calls[0]!.reject(new RpcError(-32003, "Project name changed"));
  await waitFor(() => expect(finishRead).toBeDefined());
  const newer = await edit("api");
  fireEvent.input(newer, { target: { value: "B" } });
  flush();
  press("Enter");
  await waitFor(() => expect(calls).toHaveLength(2));
  calls[1]!.accept({ path: original, name: "B" });
  await within(await screen.findByRole("tablist", { name: "Projects" })).findByRole("tab", { name: "B" });
  fireEvent.click(tab("web"));
  finishRead!([{ path: original, name: "external", running: true }]);
  await within(await screen.findByRole("tablist", { name: "Projects" })).findByRole("tab", { name: "web" });
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
  flush();
  press("Enter");
  const b = await edit("A");
  fireEvent.input(b, { target: { value: nextText } });
  flush();
  press("Escape");
  fireEvent.click(tab("web"));

  if (outcome === "acknowledged") accept!({ path: path("api"), name: "A e\u0301 🪁" });
  else reject!(new RpcError(outcome === "failed" ? -32602 : -32603, outcome));
  await waitFor(() => expect(document.querySelector(`[data-path="${path("api")}"]`)?.textContent).toContain(outcome === "acknowledged" ? "A e\u0301 🪁" : "api"));
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem(`roundup:drafts:${path("api")}`)!).drafts.some((draft: { status: string }) => draft.status === "pending")).toBe(false));
  view.unmount();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  fireEvent.click(await within(await screen.findByRole("tablist", { name: "Projects" })).findByRole("tab", { name: "api" }));
  await settled();
  const shown = await edit();
  expect(shown.value).toBe(nextText);

});

