import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
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

    expect(screen.queryByRole("textbox")).toBeNull();
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

  it("u183_the_tab_keeps_its_width_while_the_field_is_open", async () => {
    await openTabs({ api: [], web: [] });

    const wrap = tab("api").parentElement!;

    fireEvent.dblClick(tab("api").querySelector(".tab-name")!);
    await screen.findByRole("textbox");

    expect(wrap.style.width).toBe(`${wrap.offsetWidth}px`);
  });

  it("u183_a_click_elsewhere_saves_like_enter", async () => {
    await openTabs({ api: [], web: [] });
    const input = await edit();

    input.value = "payments";
    fireEvent.blur(input);

    await waitFor(() => expect(tab("payments")).toBeDefined());
  });

  it("u183_the_title_of_each_tab_holds_its_absolute_path", async () => {
    await openTabs({ api: [], web: [] });

    expect(tab("api").title).toBe(path("api"));
    expect(tab("web").title).toBe(path("web"));
  });
});
