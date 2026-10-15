import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openTabs, path, tab } from "../header/stripFixture";
import { LIST, settings } from "../models/modelsFixture";
import { agent } from "../testing/nodes";

afterEach(cleanup);

it("u480_app_models_shortcut_uses_the_active_project", async () => {
  const { app } = await openTabs({ api: [agent("a", "idle", "x")], web: [agent("w", "idle", "x")] });

  for (const name of ["api", "web"]) {
    app.of(path(name)).handlers["project.get"] = () => settings(["door"]);
    app.of(path(name)).handlers["models.list"] = () => LIST;
  }

  const comma = (repeat = false) => {
    const event = new KeyboardEvent("keydown", { code: "Comma", key: ",", metaKey: true, repeat, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    return event.defaultPrevented;
  };

  expect(comma(true)).toBe(true);
  expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
  fireEvent.click(tab("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  app.of(path("web")).calls.splice(0);
  expect(comma()).toBe(true);
  await screen.findByRole("dialog", { name: "Models" });
  await waitFor(() => expect(app.of(path("api")).calls.some((call) => call.method === "project.get")).toBe(true));
  expect(app.of(path("web")).calls.some((call) => call.method === "project.get")).toBe(false);
  fireEvent.click(tab("web"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull());
  expect(comma()).toBe(true);
  await screen.findByRole("dialog", { name: "Models" });
  await waitFor(() => expect(app.of(path("web")).calls.some((call) => call.method === "project.get")).toBe(true));
});

it("u480_app_shortcuts_leave_project_tab_rename_in_control", async () => {
  await openTabs({ api: [agent("a", "idle", "x")] });
  fireEvent.dblClick(tab("api").querySelector(".tab-name")!);
  const field = await screen.findByRole("textbox", { name: "Project name" });

  await waitFor(() => expect(document.activeElement).toBe(field));

  for (const [key, code] of [[",", "Comma"], ["1", "Digit1"], ["2", "Digit2"]]) {
    const event = new KeyboardEvent("keydown", { key, code, metaKey: true, bubbles: true, cancelable: true });

    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
  }
});
