import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const resizes = "window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length";

type Outcome = { sent: number; sliding: number; resized: boolean };

const slides = "document.getAnimations().some(a => a.playState === 'running' && a.effect?.target?.matches?.('.shelf, .shelf-scrim, .columns, .drawer'))";

/** Run one key-started change; report the resizes it sent in all, those sent while a slide was running, and whether the Terminal's visible width changed. */
const change = async (press: string[]) => {
  await evaluate(`(() => {
    const count = () => ${resizes};
    const box = () => { const e = document.querySelector('.xterm-screen'); return e?.checkVisibility() ? Math.round(e.getBoundingClientRect().width) : 0; };
    const w = window.__watch = { box, width: box(), before: count(), last: count(), sliding: 0, stop: false };
    const watch = () => { if (${slides}) w.sliding += count() - w.last; w.last = count(); if (!w.stop) requestAnimationFrame(watch); };
    requestAnimationFrame(watch);
    return true;
  })()`);
  for (const key of press) await browser("press", key);
  await settle();
  await evaluate("new Promise(resolve => setTimeout(() => resolve(true), 600))");

  return evaluate<Outcome>(`(() => { const w = window.__watch; w.stop = true; return { sent: ${resizes} - w.before, sliding: w.sliding, resized: w.width !== 0 && w.box() !== 0 && w.box() !== w.width }; })()`);
};

it("u3721b_each_size_change_sends_exactly_one_terminal_resize", async () => {
  await openShelf("agents-10", 288, 360, 1512, "dark");
  await evaluate(`(() => { document.querySelector('.rail [data-id="agent-4"] .name').click(); return true; })()`);
  await browser("wait", ".xterm-screen");
  await settle();

  // `⌘K` then `B` opens a shut Bench; `Esc` from inside it closes it (U3721a).
  const outcomes: Outcome[] = [];

  // A Bench maximise by key, from a focus inside the Bench, then its restore.
  await evaluate(`(() => { document.querySelector('.shelf-controls button').focus(); return true; })()`);
  outcomes.push(await change(["m"]));
  outcomes.push(await change(["m"]));

  outcomes.push(await change(["Escape"]));
  expect(await evaluate("document.querySelector('.window').dataset.shelf")).toBe("closed");
  outcomes.push(await change(["Meta+k", "b"]));
  expect(await evaluate("document.querySelector('.window').dataset.shelf")).toBe("open");

  // A Pad opens the Drawer on any Agent.
  await openShelf("tree-40", 288, 360, 1512, "dark");

  // A Drawer maximise and restore by key, from a Pad's Drawer opened under a selected Agent.
  await evaluate(`(() => { document.querySelector('.rail [data-id]:not([data-id=""]) .name').click(); return true; })()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await evaluate(`(() => { [...document.querySelectorAll('.shelf-tabs [role=tab]')].find(t => t.textContent.startsWith('Pads')).click(); return true; })()`);
  await settle();
  await evaluate(`(() => { document.querySelector('.shelf .pad-name').focus(); return true; })()`);
  await browser("press", "Enter");
  await browser("wait", ".drawer[data-open=true]");
  await settle();
  await evaluate(`(() => { document.querySelector('.drawer button.close').focus(); return true; })()`);
  outcomes.push(await change(["m"]));
  outcomes.push(await change(["m"]));

  // A change that leaves the Terminal's visible width as it was (a maximised surface covers the centre, hiding the Terminal, not refitting it) sends none; one that changes it sends exactly one.
  expect(outcomes.map(o => o.sent)).toEqual(outcomes.map(o => o.resized ? 1 : o.sent));
  expect(outcomes.map(o => o.sent <= 1)).toEqual(outcomes.map(() => true));
  expect(outcomes.slice(2, 4).map(o => o.sent)).toEqual([1, 1]);
  expect(outcomes.map(o => o.sliding)).toEqual([0, 0, 0, 0, 0, 0]);
}, 120_000);
