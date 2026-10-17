import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { changed, openTabs, tab, treeOf } from "./stripFixture";

afterEach(cleanup);

it.each([
  ["Workstream", "build"], ["Door", "build"], ["Agent", "child"], ["nested Agent", "nested"], ["Terminal", "terminal"],
])("u450_title_uses_the_selected_rows_workstream for %s", async (kind, selected) => {
  const build = kind === "Door" ? door("build", "idle", "ready", { name: "Build" }) : workstream("build", { name: "Build" });
  const { app } = await openTabs({ api: [build, agent("child", "idle", "ready", { parent: "build" }), agent("nested", "idle", "ready", { parent: "child" }), agent("terminal", "idle", "ready", { parent: "build", status: null, terminal_id: "t-terminal" })] });

  fireEvent.click(document.querySelector(`[data-id="${selected}"]`)!);
  await waitFor(() => expect(screen.getByRole("heading", { name: "api — Build" }).textContent).toBe("api — Build"));
  await waitFor(() => expect(app.windowOperations).toContainEqual({ kind: "title", title: "api — Build" }));
});

it("u450_switch_restores_the_projects_title", async () => {
  await openTabs({ api: [workstream("a")], web: [workstream("w")] });
  fireEvent.click(document.querySelector('[data-id="w"]')!);
  fireEvent.click(tab("api"));
  await waitFor(() => expect(document.querySelector('[data-id="a"]')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-id="a"]')!);
  fireEvent.click(tab("web"));
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("web — w"));
});

it("u450_successful_workstream_rename_updates_the_title", async () => {
  const { app } = await openTabs({ api: [workstream("a")] });
  fireEvent.click(document.querySelector('[data-id="a"]')!);
  treeOf(app, "api", [workstream("a", { name: "Renamed" })]);
  await changed(app, "api");
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("api — Renamed"));
});

it("u450_successful_project_rename_updates_the_title", async () => {
  await openTabs({ api: [] });
  fireEvent.dblClick(tab("api").querySelector('.tab-name')!);
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  input.value = "Payments";
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("Payments"));
});

it("u450_removed_selection_has_no_stale_title", async () => {
  const { app } = await openTabs({ api: [workstream("a")] });
  fireEvent.click(document.querySelector('[data-id="a"]')!);
  treeOf(app, "api", []);
  await changed(app, "api");
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("api"));
});

it("u450_background_events_do_not_change_the_title", async () => {
  const { app } = await openTabs({ api: [workstream("a")], web: [] });
  treeOf(app, "api", [workstream("a", { name: "background" })]);
  await changed(app, "api");
  expect(document.querySelector('.window-title')?.textContent).toBe("web");
});

it("u450_last_close_restores_roundup", async () => {
  await openTabs({ api: [] });
  fireEvent.click(document.querySelector('.tab-close')!);
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("roundup"));
});

it("u450_failed_rename_keeps_the_title", async () => {
  const { app } = await openTabs({ api: [] });
  app.renameProject = async () => { throw new Error("rename failed"); };

  fireEvent.dblClick(tab("api").querySelector('.tab-name')!);
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
  input.value = "Payments";
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByRole("alert");
  expect(document.querySelector('.window-title')?.textContent).toBe("api");
});

it("u450_window_title_failure_is_visible", async () => {
  const { app } = await openTabs({ api: [workstream("a")] });
  app.windowTitleHandler = async () => { throw new Error("native title failed"); };

  fireEvent.click(document.querySelector('[data-id="a"]')!);
  expect(await screen.findByText("native title failed")).toBeTruthy();
  expect(document.querySelector('.window-title')?.textContent).toBe("api — a");
});

it("u450_latest_selection_wins", async () => {
  const { app } = await openTabs({ api: [workstream("a"), workstream("b")] });
  let finish: (() => void) | undefined;
  app.windowTitleHandler = (title) => title === "api — a" ? new Promise<void>((done) => { finish = done; }) : Promise.resolve();
  fireEvent.click(document.querySelector('[data-id="a"]')!);
  await waitFor(() => expect(finish).toBeTruthy());
  fireEvent.click(document.querySelector('[data-id="b"]')!);
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("api — b"));
  finish!();
  await waitFor(() => expect(app.windowOperations.at(-1)).toEqual({ kind: "title", title: "api — b" }));
});

it("u450_project_title_changes_only_after_rename_succeeds", async () => {
  const { app } = await openTabs({ api: [] });
  let finish: (() => void) | undefined;
  const rename = app.renameProject;

  app.renameProject = async (...args) => {
    await new Promise<void>((done) => { finish = done; });

    return rename(...args);
  };

  fireEvent.dblClick(tab("api").querySelector('.tab-name')!);
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });

  input.value = "Payments";
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(finish).toBeTruthy());
  expect(document.querySelector('.window-title')?.textContent).toBe("api");
  finish!();
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("Payments"));
});

it("u450_full_title_reaches_the_window", async () => {
  const { app } = await openTabs({ api: [workstream("long", { name: "W".repeat(300) })] });

  fireEvent.click(document.querySelector('[data-id="long"]')!);
  await waitFor(() => expect(app.windowOperations.at(-1)).toEqual({ kind: "title", title: "api — " + "W".repeat(300) }));
});
