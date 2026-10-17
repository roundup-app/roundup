import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { shelfBrowser } from "./u371Browser";
import { FULLSCREEN } from "../testing/chromePage";

const { rig, evaluate, settle, openShelf, toggle, capture } = shelfBrowser();

for (const scheme of ["light"]) for (const seed of ["tree-40","agents-10","first-run"]) for (const width of [FULLSCREEN.width]) it(`u371_checks_hold_with_open_closed_and_fallback_shelf_${scheme}_${seed}_${width}`, async () => {
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

it("u371_checks_hold_with_failure_text_visible", async () => {
  await openShelf();
  await evaluate(`(() => { window.__fake.failNext(-32001,'Injected completion failure preserves the full explanation'); document.querySelector('.shelf .todo-tick:not(:disabled)').click(); return true; })()`);
  await settle();
  const observation = await evaluate<{text: string; calls: unknown}>("({text:document.querySelector('.shelf').textContent,calls:window.__fake.app.calls.slice(-5)})");
  expect(observation.text, JSON.stringify(observation.calls)).toContain('Injected completion failure preserves the full explanation');

  const checks = await evaluate<Checks>("window.__checks()");

  for (const [id,check] of Object.entries(checks)) expect(check.status, `${id}: ${JSON.stringify(check)}`).toBe("pass");

  await capture("U371", "1280x800-tree-40-failure");
}, 90_000);

it("u371_overlay_scrim_fades_with_the_interruptible_slide", async () => {
  await openShelf("agents-10", 480, 560, 1280, "dark");

  const phases = await evaluate<number[][][]>(`(async () => {
    const scrim = () => document.querySelector('.shelf-scrim');
    const sample = () => [performance.now(), scrim() ? Number(getComputedStyle(scrim()).opacity) : -1];
    const toggle = () => document.querySelector('[aria-label="Hide work items"], [aria-label="Show work items"]').click();
    const run = async (reverse) => {
      toggle();
      const rows = [sample()];
      let reversed = false;
      await new Promise(resolve => {
        const tick = () => {
          rows.push(sample());
          const slide = document.getAnimations().find(a => a.effect?.target?.matches?.('.shelf'));
          if (reverse && !reversed && slide && slide.currentTime >= slide.effect.getTiming().duration * .45) {
            const before = sample()[1];
            toggle();
            rows.push([performance.now(), sample()[1], before]);
            reversed = true;
          }
          if ((!reverse || reversed) && !document.getAnimations().some(a => a.effect?.target?.matches?.('.shelf, .shelf-scrim'))) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return rows;
    };
    return [await run(false), await run(false), await run(true)];
  })()`);

  const [close, open, reversal] = phases;
  expect(close![0]![1]).toBe(1);
  expect(close!.some(row => row[1]! > 0 && row[1]! < 1)).toBe(true);
  expect(close!.at(-1)![1]).toBe(-1);
  expect(open![0]![1]).toBe(0);
  expect(open!.some(row => row[1]! > 0 && row[1]! < 1)).toBe(true);
  expect(open!.at(-1)![1]).toBe(1);
  const interrupted = reversal!.find(row => row.length === 3)!;
  expect(interrupted[1]).toBeCloseTo(interrupted[2]!, 2);
  expect(interrupted[1]).toBeGreaterThan(0);
  expect(interrupted[1]).toBeLessThan(1);
  expect(reversal!.at(-1)![1]).toBe(1);
  const dir = captureDir("U371");

  if (dir) {
    mkdirSync(join(dir, "head"), { recursive: true });
    writeFileSync(join(dir, "head", "scrim-frames.json"), JSON.stringify(phases) + "\n");
  }
}, 90_000);
