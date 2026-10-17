import { expect, it } from "vitest";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { shelfBrowser } from "./u371Browser";
import { FULLSCREEN } from "../testing/chromePage";

const { rig, evaluate, settle, openShelf, toggle, capture } = shelfBrowser();

for (const scheme of ["dark"]) for (const seed of ["tree-40","agents-10","first-run"]) for (const width of [FULLSCREEN.width]) it(`u371_checks_hold_with_open_closed_and_fallback_shelf_${scheme}_${seed}_${width}`, async () => {
  const baselines = new Map<string, Checks>();

  for (const side of rig.main ? ['base', 'head'] : ['head']) {
    await openShelf(seed,288,320,width,scheme, (side === 'base' ? rig.main! : rig.server).resolvedUrls!.local[0]);

    for (const state of ["open", "closed", "wide-panels"]) {
      if (state === "closed") await toggle();

      if (state === "wide-panels") {
        await evaluate(`(() => { const rail=document.querySelector('.rail-edge'), shelf=document.querySelector('.shelf-edge'); for (const el of [rail,shelf]) el.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); return true; })()`);
        await settle();
        await toggle();
      }

      const checks = await evaluate<Checks>("window.__checks()");

      if (side === 'base') baselines.set(state, checks);
      else for (const id of CHECK_IDS) {
        const check = checks[id];
        // No passing Check on main may regress; head also keeps every Check green.
        expect(check.status, `${id}: ${JSON.stringify(check)}; main: ${JSON.stringify(baselines.get(state)?.[id])}`).toBe("pass");
      }

      await capture("U371", `${width}x800-${scheme}-${seed}-${state}`, side);
    }
  }
}, 120_000);
