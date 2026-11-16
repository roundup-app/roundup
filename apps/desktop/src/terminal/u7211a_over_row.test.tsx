import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { ConnectedProjectContext } from "../state/connectedProject";
import { info, node } from "../testing/nodes";
import { connectFakeProject, fakeEmulators } from "./paneHarness";
import { Pane } from "./Pane";

afterEach(cleanup);

it("u7211a_the_line_covers_the_top_row_or_the_row_below_a_cursor_near_it", async () => {
  const { connected } = await connectFakeProject([node("a")], [info("t-a")]);
  const { factory, made } = fakeEmulators();

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Pane createEmulator={factory} over={<span>line</span>} />
    </ConnectedProjectContext.Provider>
  ));
  connected.rail.select("a");
  await waitFor(() => expect(made.get("t-a")?.host).toBeTruthy());

  const over = () => document.querySelector<HTMLElement>(".pane-over")?.style;

  const covered = (cursor: number | null) => {
    made.get("t-a")?.draw({ height: 20, count: 30, cursor });

    return over()?.getPropertyValue("--over-row");
  };

  expect([5, 2, 29, null].map(covered)).toEqual(["0", "0", "0", "0"]);
  expect(covered(0)).toBe("1");
  expect(covered(1)).toBe("2");
  expect(over()?.getPropertyValue("--terminal-row")).toBe("20px");
});
