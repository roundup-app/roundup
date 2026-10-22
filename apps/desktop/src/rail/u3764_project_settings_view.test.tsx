import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const mount = async () => {
  const mounted = await mountRail([], [], () => null, () => false, { settings: true });
  mounted.app.handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: 2, models: { roles: [] } });

  return mounted.app;
};

it("u3764_project_settings_open_in_the_center_beside_the_rail_and_shelf", async () => {
  await mount();
  const opener = screen.getByRole("button", { name: "Project settings" });

  fireEvent.click(opener);

  expect(await screen.findByRole("region", { name: "Project settings" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Project settings" })).toBe(opener);
  expect(screen.getByRole("button", { name: /Overview/ })).toBeTruthy();
});

it("u3765_the_first_group_is_named_workstreams", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Project settings" }));

  const group = (await screen.findAllByRole("region")).find(region => region.classList.contains("settings-group"))!;

  expect(group.getAttribute("aria-label")).toBe("Workstreams");
  expect(within(group).getByLabelText("Workstreams at once")).toBeTruthy();
  expect(within(group).getByRole("checkbox", { name: "No limit" })).toBeTruthy();
});

it("u3766_close_returns_the_center_to_what_it_showed", async () => {
  const app = await mount();
  const opener = screen.getByRole("button", { name: "Project settings" });

  fireEvent.click(opener);
  await screen.findByRole("region", { name: "Project settings" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(screen.queryByRole("region", { name: "Project settings" })).toBeNull();
  expect(document.activeElement).toBe(opener);

  fireEvent.click(opener);
  const view = await screen.findByRole("region", { name: "Project settings" });

  expect(document.activeElement).toBe(view);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });

  expect(screen.queryByRole("region", { name: "Project settings" })).toBeNull();
  expect(document.activeElement).toBe(opener);
  await waitFor(() => expect(railCallsTo(app, "project.get").length).toBe(2));
});
