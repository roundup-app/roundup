import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { ProgramRun } from "@contracts/project/ProgramRun";
import { afterEach, expect, it, vi } from "vitest";
import { event, terminal } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("pg3_the_row_offers_stop_when_running_and_start_when_down", async () => {
  const mounted = await mountRail([terminal("t1")]);
  let run: ProgramRun = { state: "running", terminalId: "t1" };

  mounted.app.handlers["project.programRun"] = () => run;
  mounted.app.handlers["project.stopProgram"] = () => { run = { state: "stopped" };

 return null; };

  mounted.app.handlers["project.startProgram"] = () => { run = { state: "running", terminalId: "t1" };

 return null; };

  mounted.app.emit(event({ name: "terminal.changed" }));

  // Running: the one Stop is on the program's own Terminal row, and no footer row repeats it.
  const stop = await screen.findByRole("button", { name: "Stop program" });

  expect(document.querySelectorAll(".rail-program")).toHaveLength(0);
  expect(document.querySelectorAll("[data-id='t1'] .row-program-stop")).toHaveLength(1);

  fireEvent.click(stop);

  await waitFor(() => expect(railCallsTo(mounted.app, "project.stopProgram")).toHaveLength(1));
  await screen.findByText("Stopped");

  fireEvent.click(screen.getByRole("button", { name: "Start" }));

  await waitFor(() => expect(railCallsTo(mounted.app, "project.startProgram")).toHaveLength(1));
  await screen.findByRole("button", { name: "Stop program" });
});

it("pg3_the_restart_countdown_ticks_each_second", async () => {
  const mounted = await mountRail([]);

  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

  mounted.app.handlers["project.programRun"] = () => ({ state: "restarting", restartAt: Date.now() + 5000 });
  mounted.app.emit(event({ name: "terminal.changed" }));

  const wait = async () => vi.waitFor(() => {
    const text = document.querySelector(".rail-program .light")?.textContent ?? "";

    expect(text).not.toBe("");

    return Number(/\d+/.exec(text)?.[0]);
  });

  const first = await wait();

  vi.advanceTimersByTime(2000);

  await vi.waitFor(async () => expect(await wait()).toBe(first - 2));
});

it("pg3_a_refused_stop_or_start_shows_its_failure", async () => {
  const mounted = await mountRail([]);

  mounted.app.handlers["project.programRun"] = () => ({ state: "stopped" });
  mounted.app.handlers["project.startProgram"] = () => { throw new Error("conflict"); };

  mounted.app.emit(event({ name: "terminal.changed" }));


  fireEvent.click(await screen.findByRole("button", { name: "Start" }));

  await screen.findByText(/conflict/);
});
