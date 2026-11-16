import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { peekBench } from "./u6224Browser";

const { browser, evaluate, settle, calls, saved, pause, toEdge, toCentre, waitFor, closedBenchOverATerminal } = peekBench();

/** Records whether the Bench ever peeked: a peek that already slid back must still fail the test. */
const watchPeeks = () => evaluate<boolean>(`(() => {
  window.__peeked = false;
  new MutationObserver(() => { if (document.querySelector('.window').dataset.shelf === 'peek') window.__peeked = true; })
    .observe(document.querySelector('.window'), { attributes: true, attributeFilter: ['data-shelf'] });
  return true;
})()`);

const everPeeked = () => evaluate<boolean>("window.__peeked");

it("u6224_a_rest_at_the_edge_peeks_the_bench_in", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await settle();
  expect(await evaluate("document.querySelector('.shelf-scrim')")).toBeNull();
  expect(await calls("terminal.resize")).toBe(0);

  const root = captureDir("U6224");

  if (!root) return;
  // The critic's frame: dark, the one viewport, the peek still covering a selected Terminal.
  const dir = join(root, "head");

  mkdirSync(dir, { recursive: true });
  await browser("set", "media", "dark");
  await browser("set", "viewport", "1512", "950");
  await settle();
  await browser("screenshot", join(dir, "peek.png"));
  writeFileSync(join(dir, "peek.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
}, 90_000);

it("u6224_a_fast_pass_peeks_nothing", async () => {
  await closedBenchOverATerminal();
  await watchPeeks();
  // One eval keeps the pass inside the dwell: a process per mouse move would not.
  await evaluate(`(async () => {
    const move = x => document.elementFromPoint(x, 400).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: 400 }));
    move(document.documentElement.clientWidth - 1);
    await new Promise(resolve => setTimeout(resolve, 60));
    move(500);
    return true;
  })()`);
  await pause(600);
  expect(await everPeeked()).toBe(false);
}, 90_000);

it("u6224_a_pressed_button_peeks_nothing", async () => {
  await closedBenchOverATerminal();
  await watchPeeks();
  await browser("mouse", "move", "500", "400");
  await browser("mouse", "down");
  await toEdge();
  await pause(600);
  await browser("mouse", "up");
  expect(await everPeeked()).toBe(false);
}, 90_000);

it("u6224_the_terminal_scrollbar_peeks_nothing", async () => {
  await closedBenchOverATerminal();
  await evaluate("(() => { window.__fake.writeOutput('t-agent-4', 'line\\r\\n'.repeat(300)); return true; })()");
  await settle();

  const bar = await evaluate<{ x: number; y: number } | null>(`(() => {
    const r = document.querySelector('.xterm-scrollbar.xterm-vertical')?.getBoundingClientRect();
    return r && { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  await watchPeeks();
  await browser("mouse", "move", String(bar!.x), String(bar!.y));
  await pause(600);
  expect(await everPeeked()).toBe(false);
}, 90_000);

it("u6224_a_peek_that_slides_back_saves_nothing_and_resizes_nothing", async () => {
  await closedBenchOverATerminal();
  const before = await saved();

  await toEdge();
  await waitFor("peek");
  await toCentre();
  await waitFor("closed");
  await browser("wait", "--fn", "document.querySelector('.shelf').hidden");
  await settle();
  expect(await calls("terminal.resize")).toBe(0);
  expect(await saved()).toBe(before);
}, 90_000);
