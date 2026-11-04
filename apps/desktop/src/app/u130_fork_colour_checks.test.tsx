import { batch } from "solid-js";
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { CHECK_IDS, runChecks } from "../testing/checks";
import { withStylesheets } from "../testing/contrast";
import { seedApp } from "../testing/seeds";

const COLOURS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;

afterEach(() => {
  batch(cleanup);
  delete document.documentElement.dataset.forkColour;
  delete document.documentElement.dataset.mode;
});

const statuses = () => withStylesheets(() => {
  const controls = seedApp("agents-10", Date.now());

  render(() => <App app={controls.app} reducedMotion={() => false} clock={Date.now} />);

  const checks = runChecks();

  return Object.fromEntries(CHECK_IDS.map((id) => [id, checks[id].status]));
});

describe("u130 fork colour checks", () => {
  it("u130_fork_colour_checks_hold", async () => {
    for (const mode of ["light", "dark"] as const) {
      document.documentElement.dataset.mode = mode;
      const live = await statuses();

      batch(cleanup);

      for (const colour of COLOURS) {
        document.documentElement.dataset.forkColour = colour;
        const forked = await statuses();

        batch(cleanup);

        for (const id of CHECK_IDS) if (live[id] === "pass") expect([mode, colour, id, forked[id]]).toEqual([mode, colour, id, "pass"]);
      }

      delete document.documentElement.dataset.forkColour;
    }
  });
});
