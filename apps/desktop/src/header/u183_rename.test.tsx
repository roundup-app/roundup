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


it.each([false, true])("u2773b_header_settlement_preserves_other_revisions_other_project_%s", async (switchProject) => {
  const { app } = await openTabs({ api: [], web: [] });
  const state = createRoot(() => createProjectsState(app));
  await waitFor(() => expect(state.loaded()).toBe(true));
  const calls: { path: string; name: string; accept: (project: { path: string; name: string }) => void; reject: (error: Error) => void }[] = [];
  app.renameProject = (path, name) => new Promise((accept, reject) => { calls.push({ path, name, accept, reject }); });
  const a = state.rename(path("api"), " A 雪 ");
  const b = state.rename(path("api"), "B");
  if (switchProject) state.select(path("web"));
  calls[1]!.accept({ path: path("api"), name: "B" });
  const acknowledged = await b;
  expect(acknowledged).toMatchObject({ status: "acknowledged", path: path("api"), name: "B" });
  calls[0]!.reject(new RpcError(-32602, "rejected"));
  const rejected = await a;
  expect(rejected).toMatchObject({ status: "failed", path: path("api"), name: " A 雪 " });
  expect(rejected.revision).not.toBe(acknowledged.revision);
  expect(state.tabs().find(tab => tab.project.path === path("api"))?.project.name).toBe("B");
  expect(state.tabs().find(tab => tab.project.path === path("web"))?.project.name).toBe("web");
  const unknown = state.rename(path("api"), "C");
  calls[2]!.reject(new RpcError(-32603, "disconnected"));
  expect(await unknown).toMatchObject({ status: "unknown", path: path("api"), name: "C" });
  expect(calls.map(({ path, name }) => [path, name])).toEqual([[path("api"), " A 雪 "], [path("api"), "B"], [path("api"), "C"]]);
});
