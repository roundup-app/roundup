import { ToastHost } from "../testing/toastHost";
import { ConnectedProjectContext } from "../state/connectedProject";
import { ProjectPage } from "../settings/ProjectPage";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountRail, railCallsTo, settled } from "./railFixture";

afterEach(cleanup);

const mount = async (program: { argv: string[]; dir: string; adoptDir?: string } | null) => {
  const mounted = await mountRail([]);
  mounted.app.handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: null, machine: null, program, models: { roles: [] } });
  mounted.app.handlers["project.setProgram"] = () => null;
  mounted.app.handlers["project.clearProgram"] = () => null;
  render(() => <ToastHost><ConnectedProjectContext value={mounted.connected}><ProjectPage /></ConnectedProjectContext></ToastHost>);

  return mounted.app;
};

const field = (name: string) => screen.findByLabelText<HTMLTextAreaElement>(name);

it("pg6_the_section_reads_what_the_daemon_stores", async () => {
  await mount({ argv: ["pnpm", "dev", "my app"], dir: "web" });

  await waitFor(async () => expect((await field("Command")).value).toBe('pnpm dev "my app"'));
  expect((await field("Folder")).value).toBe("web");
  expect(screen.getByText(/whenever the Project is open\. It starts again after a crash/)).toBeTruthy();
});

it("pg6_a_commit_sets_the_program_once_and_clear_clears_it", async () => {
  const app = await mount({ argv: ["old"], dir: "." });
  const command = await field("Command");

  await waitFor(() => expect(command.value).toBe("old"));
  fireEvent.input(command, { target: { value: "make 'run it'" } });
  fireEvent.keyDown(command, { key: "Enter" });
  fireEvent.blur(command);

  await waitFor(() => expect(railCallsTo(app, "project.setProgram")).toEqual([{ argv: ["make", "run it"], dir: "." }]));

  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));

  await waitFor(() => expect(railCallsTo(app, "project.clearProgram")).toHaveLength(1));
});

it("pg6_a_bad_command_or_folder_calls_nothing_and_keeps_the_entry", async () => {
  const app = await mount({ argv: ["old"], dir: "." });
  const command = await field("Command");
  const folder = await field("Folder");

  await waitFor(() => expect(command.value).toBe("old"));

  for (const bad of ["", "run 'open"]) {
    fireEvent.input(command, { target: { value: bad } });
    fireEvent.keyDown(command, { key: "Enter" });

    expect(await screen.findByText(/^✕ /)).toBeTruthy();
  }

  fireEvent.input(command, { target: { value: "ok" } });
  fireEvent.input(folder, { target: { value: "../out" } });
  fireEvent.keyDown(folder, { key: "Enter" });

  expect(await screen.findByText(/^✕ .*path/i)).toBeTruthy();
  expect(railCallsTo(app, "project.setProgram")).toEqual([]);
});

it("g13_the_worktree_path_is_saved_with_the_entry_and_a_path_outside_is_refused", async () => {
  const app = await mount({ argv: ["old"], dir: ".", adoptDir: "trees" });
  const folder = await field("Worktree path");

  await waitFor(() => expect(folder.value).toBe("trees"));
  fireEvent.input(folder, { target: { value: "../out" } });
  fireEvent.keyDown(folder, { key: "Enter" });

  expect(await screen.findByText(/^✕ .*path/i)).toBeTruthy();
  expect(railCallsTo(app, "project.setProgram")).toEqual([]);

  fireEvent.input(folder, { target: { value: "wt" } });
  fireEvent.keyDown(folder, { key: "Enter" });

  await waitFor(() => expect(railCallsTo(app, "project.setProgram")).toEqual([{ argv: ["old"], dir: ".", adoptDir: "wt" }]));
});
