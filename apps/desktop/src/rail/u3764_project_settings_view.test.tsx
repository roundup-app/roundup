import { openProjectPage } from "../testing/menuProbe";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const mount = async () => {
  const mounted = await mountRail([]);
  mounted.app.handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: 2, models: { roles: [] } });

  return mounted.app;
};

it("u3766_close_returns_the_center_to_what_it_showed", async () => {
  const app = await mount();
  const opener = screen.getByRole("button", { name: /Overview/ });
  opener.focus();

  openProjectPage("project-settings");
  await screen.findByRole("region", { name: "Project settings" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(screen.queryByRole("region", { name: "Project settings" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(opener));

  openProjectPage("project-settings");
  const view = await screen.findByRole("region", { name: "Project settings" });

  expect(document.activeElement).toBe(view);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });

  expect(screen.queryByRole("region", { name: "Project settings" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(opener));
  await waitFor(() => expect(railCallsTo(app, "project.get").length).toBe(2));
});
