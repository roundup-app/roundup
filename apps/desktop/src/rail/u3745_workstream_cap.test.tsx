import { openProjectPage } from "../testing/menuProbe";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const mount = async (cap: number | null) => {
  const mounted = await mountRail([]);
  mounted.app.handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: cap, models: { roles: [] } });
  mounted.app.handlers["project.setWorkstreamCap"] = () => null;

  openProjectPage("project-settings");

  return { app: mounted.app, field: async () => await screen.findByLabelText<HTMLInputElement>("Workstreams at once") };
};

it("u3745_a_commit_sets_the_cap_once_and_no_limit_sets_null", async () => {
  const { app, field } = await mount(2);
  const input = await field();

  await waitFor(() => expect(input.value).toBe("2"));
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "No limit" }).checked).toBe(false);

  fireEvent.input(input, { target: { value: "3" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);

  await waitFor(() => expect(railCallsTo(app, "project.setWorkstreamCap")).toEqual([{ cap: 3 }]));

  fireEvent.click(screen.getByRole("checkbox", { name: "No limit" }));

  await waitFor(() => expect(railCallsTo(app, "project.setWorkstreamCap")).toEqual([{ cap: 3 }, { cap: null }]));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "No limit" }).checked).toBe(true));
});

it("u3745_a_bad_entry_calls_nothing_and_keeps_the_cap", async () => {
  const { app, field } = await mount(2);
  const input = await field();

  await waitFor(() => expect(input.value).toBe("2"));

  for (const bad of ["0", "1.5", "-1", "two", ""]) {
    fireEvent.input(input, { target: { value: bad } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/whole number/)).toBeTruthy();
  }

  expect(railCallsTo(app, "project.setWorkstreamCap")).toEqual([]);
});

it("u3745_no_limit_shows_when_the_project_has_no_cap", async () => {
  const { field } = await mount(null);

  await field();

  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "No limit" }).checked).toBe(true));
});
