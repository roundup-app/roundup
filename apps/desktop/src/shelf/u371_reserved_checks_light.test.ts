import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { evaluate, settle, openShelf } = shelfBrowser();

it("u371_failure_text_stays_visible", async () => {
  await openShelf();
  await evaluate(`(() => { window.__fake.failNext(-32001,'Injected completion failure preserves the full explanation'); document.querySelector('.shelf .todo-tick:not(:disabled)').click(); return true; })()`);
  await settle();
  const observation = await evaluate<{text: string; calls: unknown}>("({text:document.querySelector('.shelf').textContent,calls:window.__fake.app.calls.slice(-5)})");
  expect(observation.text, JSON.stringify(observation.calls)).toContain('Injected completion failure preserves the full explanation');
}, 90_000);

it("u371_overlay_scrim_fades_with_the_interruptible_slide", async () => {
  await openShelf("agents-10", 480, 560, 1280, "dark");

  const phases = await evaluate<number[][][]>(`(async () => {
    const scrim = () => document.querySelector('.shelf-scrim');
    const sample = () => [performance.now(), scrim() ? Number(getComputedStyle(scrim()).opacity) : -1];
    const toggle = () => document.querySelector('.shelf-tab[data-selected]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const run = async (reverse) => {
      toggle();
      const rows = [sample()];
      let reversed = false;
      await new Promise((resolve, reject) => {
        const tick = () => {
          rows.push(sample());
          const slide = document.getAnimations().find(a => a.effect?.target?.matches?.('.shelf'));
          if (reverse && !reversed && !slide) {
            reject(new Error('Shelf slide ended before pointer reversal'));
            return;
          }
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
}, 90_000);
