import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { ProgramRun } from "@contracts/project/ProgramRun";
import { afterEach, expect, it } from "vitest";
import { event } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

it("pg3_the_row_offers_stop_when_running_and_start_when_down", async () => {
  const mounted = await mountRail([]);
  let run: ProgramRun = { state: "running", terminalId: "t1" };

  mounted.app.handlers["project.programRun"] = () => run;
  mounted.app.handlers["project.stopProgram"] = () => { run = { state: "stopped" };

 return null; };

  mounted.app.handlers["project.startProgram"] = () => { run = { state: "running", terminalId: "t1" };

 return null; };

  mounted.app.emit(event({ name: "terminal.changed" }));

  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

  await waitFor(() => expect(railCallsTo(mounted.app, "project.stopProgram")).toHaveLength(1));
  await screen.findByText("Stopped");

  fireEvent.click(screen.getByRole("button", { name: "Start" }));

  await waitFor(() => expect(railCallsTo(mounted.app, "project.startProgram")).toHaveLength(1));
  await screen.findByRole("button", { name: "Stop" });
});
