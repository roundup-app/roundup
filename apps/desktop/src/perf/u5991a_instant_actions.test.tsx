import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { actions } from "../rail/menu/u5991Harness";
import { percentile } from "./keystrokes";

afterEach(cleanup);

const INPUTS = ["keydown", "click", "input", "pointerdown", "contextmenu"] as const;

/** One frame is rule 7's 16 ms budget; jsdom's own DOM cost is no evidence of a browser's, so the journal counts frames, as `frames.ts` does, not milliseconds. */
const MAX_FRAMES_LATE = 0;

/** Frames between an action's last input and the first frame that shows its result, 0 being the very next frame, while its call stays pending. */
const framesLate = async (action: (typeof actions)[number]): Promise<number> => {
  cleanup();
  const mounted = await action.mount();
  mounted.app.handlers[action.method] = () => new Promise<never>(() => undefined);
  mounted.app.handlers["rail.deletion"] = () => null;
  await new Promise(resolve => setTimeout(resolve));
  await action.prepare?.(mounted);
  let frame = 0;
  let inputAt = 0;
  let shownAt: number | null = null;
  let running = true;

  const shows = () => {
    try { action.shown(mounted);

 return true; } catch { return false; }
  };

  const tick = () => {
    if (!running) return;
    frame += 1;

    if (shownAt === null && shows()) shownAt = frame;
    requestAnimationFrame(tick);
  };

  // The journal's frame is the first one after the input, so a stamp counts from the frame about to run.
  const stamp = () => { inputAt = frame + 1; shownAt = null; };

  // An action with no input event of its own counts from the call that fires it.
  stamp();

  for (const name of INPUTS) document.addEventListener(name, stamp, true);
  requestAnimationFrame(tick);

  try {
    await action.fire(mounted);
    const end = performance.now() + 2000;

    while (shownAt === null && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 5));

    if (shownAt === null) throw new Error(`${action.name}: its result never reached the Rail`);

    return Math.max(shownAt - inputAt, 0);
  } finally {
    running = false;

    for (const name of INPUTS) document.removeEventListener(name, stamp, true);
  }
};

it("u5991a_key_to_render_stays_under_the_frame_budget", async () => {
  // The first mount warms the module graph and the document; it is not a sample.
  await framesLate(actions[0]!);
  const samples: number[] = [];

  for (const action of actions) samples.push(await framesLate(action));
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(percentile(samples.toSorted((a, b) => a - b), 0.95)).toBeLessThanOrEqual(MAX_FRAMES_LATE);
}, 60_000);
