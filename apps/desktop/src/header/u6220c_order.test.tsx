import { cleanup, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectsState } from "../state/projects";
import { openTabs, path } from "./stripFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const opened = async () => {
  const { app } = await openTabs({ api: [], web: [], db: [] });
  const state = createRoot(() => createProjectsState(app));

  await waitFor(() => expect(state.loaded()).toBe(true));

  return { app, state };
};

const names = (state: Awaited<ReturnType<typeof opened>>["state"]) => state.tabs().map(each => each.project.name);

describe("u6220c Project tabs keep the order the user left", () => {
  it("u6220c_a_reordered_tab_list_survives_a_reload_and_a_restart", async () => {
    const { app, state } = await opened();
    expect(names(state)).toEqual(["api", "web", "db"]);

    state.reorder([path("web"), path("db"), path("api")]);
    expect(names(state)).toEqual(["web", "db", "api"]);

    await state.reload();
    expect(names(state)).toEqual(["web", "db", "api"]);

    const restarted = createRoot(() => createProjectsState(app));
    await waitFor(() => expect(restarted.loaded()).toBe(true));
    expect(names(restarted)).toEqual(["web", "db", "api"]);
  });

  it("u6220c_a_tab_missing_from_the_saved_order_goes_last", async () => {
    const { app, state } = await opened();

    state.reorder([path("db"), path("api")]);

    const restarted = createRoot(() => createProjectsState(app));
    await waitFor(() => expect(restarted.loaded()).toBe(true));
    expect(names(restarted)).toEqual(["db", "api", "web"]);
  });
});
