import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createProjectsState } from "../state/projects";
import { RpcError } from "../app/seam";
import { openTabs, path, tab, projectTabs } from "./stripFixture";

afterEach(cleanup);

const field = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" });

const edit = async (name = "api") => {
  fireEvent.dblClick(tab(name).querySelector(".tab-name")!);

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

  it("u183_f2_opens_it_from_the_focused_tab", async () => {
    await openTabs({ api: [], web: [] });

    tab("api").focus();
    fireEvent.keyDown(tab("api"), { key: "F2" });

    expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" })).value).toBe("api");
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

  it("u183_escape_cancels_and_calls_nothing", async () => {
    const { app } = await openTabs({ api: [], web: [] });
    const input = await edit();
    let renamed = 0;
    const rename = app.renameProject;

    app.renameProject = (...args) => (renamed++, rename(...args));
    input.value = "other";
    press("Escape");

    expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull();
    expect(tab("api").textContent).toBe("api");
    expect(renamed).toBe(0);
    expect(document.activeElement).toBe(tab("api"));
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

  it("u183_the_path_is_available_in_a_linked_tooltip", async () => {
    await openTabs({ api: [], web: [] });
    fireEvent.pointerOver(tab("api"), { pointerType: "mouse" });
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(path("api"));
    expect(tab("api").getAttribute("aria-describedby")).toBe(tooltip.id);
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
  replies[1]!.accept({ path: path("api"), name: "B" });
  await waitFor(() => expect(tab("B")).toBeDefined());
  replies[0]!.reject(new RpcError(-32602, "older rename rejected"));
  await screen.findByText("older rename rejected");
  expect(tab("B")).toBeDefined();
  fireEvent.click(tab("B"));
  await waitFor(() => expect(document.querySelector(".window-title")?.textContent).toBe("B"));
  expect(replies).toHaveLength(2);
});
