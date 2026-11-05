import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { actions } from "../rail/menu/u5991Harness";
import { framesLate, MAX_FRAMES_LATE } from "./framesLate";
import { percentile } from "./keystrokes";

afterEach(cleanup);

it("u5991a_key_to_render_stays_under_the_frame_budget", async () => {
  // The first mount warms the module graph and the document; it is not a sample.
  await framesLate(actions[0]!);
  const samples: number[] = [];

  for (const action of actions) samples.push(await framesLate(action));
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(percentile(samples.toSorted((a, b) => a - b), 0.95)).toBeLessThanOrEqual(MAX_FRAMES_LATE);
}, 60_000);
