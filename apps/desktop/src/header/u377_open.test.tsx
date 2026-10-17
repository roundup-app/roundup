import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { LIST, settings } from "../models/modelsFixture";
import { agent } from "../testing/nodes";
import { openTabs, path, tab } from "./stripFixture";

afterEach(cleanup);

const open = async () => {
  const mounted = await openTabs({ api: [agent("a", "idle", "x")], web: [agent("w", "idle", "x")] });

  for (const name of ["api", "web"]) {
    const daemon = mounted.app.of(path(name));

    daemon.handlers["project.get"] = () => settings(["door"]);
    daemon.handlers["models.list"] = () => LIST;
  }

  return mounted;
};

describe("u377 opening the Models sheet", () => {
  it("u377_cmd_comma_opens_the_sheet_of_the_open_project", async () => {
    const { app } = await open();

    const press = new KeyboardEvent("keydown", { code: "Comma", key: ",", metaKey: true, bubbles: true, cancelable: true });

    document.body.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
    expect(await screen.findByRole("dialog", { name: "Models" })).toBeTruthy();
    await waitFor(() => expect(app.of(path("web")).calls.some((call) => call.method === "project.get")).toBe(true));
  });

  it("u377_the_tab_menu_offers_models_for_that_project", async () => {
    const { app } = await open();

    fireEvent.contextMenu(tab("api"), { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Models" }));

    expect(await screen.findByRole("dialog", { name: "Models" })).toBeTruthy();
    await waitFor(() => expect(app.of(path("api")).calls.some((call) => call.method === "project.get")).toBe(true));
    expect(tab("api").getAttribute("aria-selected")).toBe("true");
  });
});
