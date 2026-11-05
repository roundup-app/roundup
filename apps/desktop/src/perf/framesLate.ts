import { cleanup } from "@solidjs/testing-library";
import type { mountRail } from "../rail/railFixture";
import type { Handlers } from "../testing/fakeApp";

type Mounted = Awaited<ReturnType<typeof mountRail>>;

const INPUTS = ["keydown", "click", "input", "pointerdown", "contextmenu"] as const;

/** One action the journal times: `fire` runs it by its key or click while the fake Daemon holds `method` pending, and `shown` throws until its result is on screen. */
export type TimedAction = { name: string; mount: () => Promise<Mounted>; method: keyof Handlers; prepare?: (mounted: Mounted) => Promise<void>; fire: (mounted: Mounted) => Promise<void> | void; shown: (mounted: Mounted) => void };

/** One frame is rule 7's 16 ms budget; jsdom's own DOM cost is no evidence of a browser's, so the journal counts frames, as `frames.ts` does, not milliseconds. */
export const MAX_FRAMES_LATE = 0;

/** Frames between an action's last input and the first frame that shows its result, 0 being the very next frame, while its call stays pending. */
export const framesLate = async (action: TimedAction): Promise<number> => {
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
